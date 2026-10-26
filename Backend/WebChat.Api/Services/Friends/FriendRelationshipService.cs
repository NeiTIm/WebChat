using Microsoft.EntityFrameworkCore;
using WebChat.Api.Data;
using WebChat.Api.DTOs.Friends;
using WebChat.Api.Models;

namespace WebChat.Api.Services.Friends;

public sealed class FriendRelationshipService
    : IFriendRelationshipService
{
    private readonly AppDbContext _db;

    public FriendRelationshipService(AppDbContext db)
    {
        _db = db;
    }

    // =====================================================
    // GET FRIENDS
    // =====================================================

    // =====================================================
    // GET FRIENDS
    // =====================================================

    public async Task<FriendUserListResponse> GetFriendsAsync(
        Guid currentUserId,
        int page,
        int pageSize,
        CancellationToken ct = default)
    {
        ValidatePagination(page, pageSize);

        // Lấy các quan hệ mà user hiện tại là UserA.
        var fromUserA = _db.Friendships
            .AsNoTracking()
            .Where(x => x.UserAId == currentUserId)
            .Select(x => new
            {
                FriendUserId = x.UserBId,
                SinceUtc = x.CreatedAtUtc
            });

        // Lấy các quan hệ mà user hiện tại là UserB.
        var fromUserB = _db.Friendships
            .AsNoTracking()
            .Where(x => x.UserBId == currentUserId)
            .Select(x => new
            {
                FriendUserId = x.UserAId,
                SinceUtc = x.CreatedAtUtc
            });

        // Gộp hai chiều quan hệ.
        var friendRelations = fromUserA.Concat(fromUserB);

        // Join về bảng Users để lấy thông tin bạn bè.
        var query =
            from relation in friendRelations
            join user in _db.Users.AsNoTracking()
                on relation.FriendUserId equals user.Id
            where user.IsActive
            select new FriendUserResponse
            {
                UserId = user.Id,
                Username = user.Username,
                DisplayName = user.DisplayName,
                AvatarUrl = user.AvatarUrl,
                Bio = user.Bio,
                SinceUtc = relation.SinceUtc
            };

        return await BuildPagedListAsync(
            query,
            page,
            pageSize,
            ct);
    }

    // =====================================================
    // REMOVE FRIEND
    // =====================================================

    public async Task RemoveFriendAsync(
        Guid currentUserId,
        Guid friendUserId,
        CancellationToken ct = default)
    {
        EnsureDifferentUsers(currentUserId, friendUserId);

        await using var transaction =
            await _db.Database.BeginTransactionAsync(ct);

        await FriendPairLock.AcquireAsync(
            _db,
            currentUserId,
            friendUserId,
            ct);

        var friendship = await _db.Friendships
            .FirstOrDefaultAsync(
                x =>
                    (x.UserAId == currentUserId &&
                     x.UserBId == friendUserId)
                    ||
                    (x.UserAId == friendUserId &&
                     x.UserBId == currentUserId),
                ct);

        if (friendship is null)
        {
            throw new FriendRequestException(
                "Hai người hiện không phải bạn bè.",
                404);
        }

        var now = DateTime.UtcNow;

        _db.Friendships.Remove(friendship);

        AddAudit(
            currentUserId,
            friendUserId,
            "Friendship.Removed",
            friendship.Id,
            now);

        await _db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
    }

    // =====================================================
    // BLOCK USER
    // =====================================================

    public async Task BlockUserAsync(
        Guid currentUserId,
        Guid targetUserId,
        CancellationToken ct = default)
    {
        EnsureDifferentUsers(currentUserId, targetUserId);

        await using var transaction =
            await _db.Database.BeginTransactionAsync(ct);

        await FriendPairLock.AcquireAsync(
            _db,
            currentUserId,
            targetUserId,
            ct);

        // Kiểm tra lại sau khi đã lấy khóa.
        await EnsureActiveUsersAsync(
            currentUserId,
            targetUserId,
            ct);

        var exists = await _db.UserBlocks
            .AsNoTracking()
            .AnyAsync(
                x => x.BlockerId == currentUserId &&
                     x.BlockedId == targetUserId,
                ct);

        if (exists)
        {
            throw new FriendRequestException(
                "Bạn đã chặn người dùng này.",
                409);
        }

        var now = DateTime.UtcNow;

        var block = new UserBlock
        {
            Id = Guid.NewGuid(),
            BlockerId = currentUserId,
            BlockedId = targetUserId,
            CreatedAtUtc = now
        };

        _db.UserBlocks.Add(block);

        AddAudit(
            currentUserId,
            targetUserId,
            "UserBlock.Created",
            block.Id,
            now);

        // 1. Nếu đang là bạn bè:
        // Xóa Friendship và lưu audit.
        var friendship = await _db.Friendships
            .FirstOrDefaultAsync(
                x =>
                    (x.UserAId == currentUserId &&
                     x.UserBId == targetUserId)
                    ||
                    (x.UserAId == targetUserId &&
                     x.UserBId == currentUserId),
                ct);

        if (friendship is not null)
        {
            _db.Friendships.Remove(friendship);

            AddAudit(
                currentUserId,
                targetUserId,
                "Friendship.Removed",
                friendship.Id,
                now);
        }

        // 2. Hủy mọi Pending Request giữa hai người.
        // Không xóa lịch sử lời mời.
        var pendingRequests = await _db.FriendRequests
            .Where(x =>
                x.Status == FriendRequestStatus.Pending
                &&
                (
                    (x.SenderId == currentUserId &&
                     x.ReceiverId == targetUserId)
                    ||
                    (x.SenderId == targetUserId &&
                     x.ReceiverId == currentUserId)
                ))
            .ToListAsync(ct);

        foreach (var request in pendingRequests)
        {
            request.Status = FriendRequestStatus.Cancelled;
            request.CancelledAtUtc = now;
            request.RespondedAtUtc = null;

            AddAudit(
                currentUserId,
                targetUserId,
                "FriendRequest.Cancelled",
                request.Id,
                now);
        }

        // Block + Remove Friendship + Cancel Requests
        // + toàn bộ Audit cùng một transaction.
        await _db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
    }

    // =====================================================
    // UNBLOCK USER
    // =====================================================

    public async Task UnblockUserAsync(
        Guid currentUserId,
        Guid targetUserId,
        CancellationToken ct = default)
    {
        EnsureDifferentUsers(currentUserId, targetUserId);

        await using var transaction =
            await _db.Database.BeginTransactionAsync(ct);

        await FriendPairLock.AcquireAsync(
            _db,
            currentUserId,
            targetUserId,
            ct);

        var block = await _db.UserBlocks
            .FirstOrDefaultAsync(
                x => x.BlockerId == currentUserId &&
                     x.BlockedId == targetUserId,
                ct);

        if (block is null)
        {
            throw new FriendRequestException(
                "Bạn chưa chặn người dùng này.",
                404);
        }

        var now = DateTime.UtcNow;

        _db.UserBlocks.Remove(block);

        AddAudit(
            currentUserId,
            targetUserId,
            "UserBlock.Removed",
            block.Id,
            now);

        // Không tạo lại Friendship hoặc Pending Request.
        await _db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
    }

    // =====================================================
    // GET BLOCKED USERS
    // =====================================================

    public async Task<FriendUserListResponse> GetBlockedUsersAsync(
        Guid currentUserId,
        int page,
        int pageSize,
        CancellationToken ct = default)
    {
        ValidatePagination(page, pageSize);

        // Bao gồm cả tài khoản đã inactive để
        // chủ tài khoản vẫn xem và bỏ chặn được.
        var query =
            from block in _db.UserBlocks.AsNoTracking()
            join user in _db.Users.AsNoTracking()
                on block.BlockedId equals user.Id
            where block.BlockerId == currentUserId
            select new FriendUserResponse
            {
                UserId = user.Id,
                Username = user.Username,
                DisplayName = user.DisplayName,
                AvatarUrl = user.AvatarUrl,
                Bio = user.Bio,
                SinceUtc = block.CreatedAtUtc
            };

        return await BuildPagedListAsync(
            query,
            page,
            pageSize,
            ct);
    }

    // =====================================================
    // PAGINATION
    // =====================================================

    private static void ValidatePagination(
        int page,
        int pageSize)
    {
        if (page < 1 || page > 100000)
        {
            throw new FriendRequestException(
                "Số trang không hợp lệ.",
                400);
        }

        if (pageSize is < 20 or > 50)
        {
            throw new FriendRequestException(
                "PageSize phải nằm trong khoảng 20 đến 50.",
                400);
        }
    }

    private static async Task<FriendUserListResponse>
        BuildPagedListAsync(
            IQueryable<FriendUserResponse> query,
            int page,
            int pageSize,
            CancellationToken ct)
    {
        var total = await query.CountAsync(ct);

        var items = await query
            .OrderByDescending(x => x.SinceUtc)
            .ThenBy(x => x.UserId)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(ct);

        var totalPages = total == 0
            ? 0
            : (int)Math.Ceiling(
                (double)total / pageSize);

        return new FriendUserListResponse
        {
            Items = items,
            Page = page,
            PageSize = pageSize,
            Total = total,
            TotalPages = totalPages,
            HasPreviousPage = page > 1,
            HasNextPage = page < totalPages
        };
    }

    // =====================================================
    // VALIDATION
    // =====================================================

    private static void EnsureDifferentUsers(
        Guid currentUserId,
        Guid targetUserId)
    {
        if (currentUserId == Guid.Empty ||
            targetUserId == Guid.Empty)
        {
            throw new FriendRequestException(
                "User ID không hợp lệ.",
                400);
        }

        if (currentUserId == targetUserId)
        {
            throw new FriendRequestException(
                "Bạn không thể thực hiện thao tác này " +
                "với chính mình.",
                400);
        }
    }

    private async Task EnsureActiveUsersAsync(
        Guid currentUserId,
        Guid targetUserId,
        CancellationToken ct)
    {
        var count = await _db.Users
            .AsNoTracking()
            .CountAsync(
                x =>
                    (x.Id == currentUserId ||
                     x.Id == targetUserId)
                    && x.IsActive,
                ct);

        if (count != 2)
        {
            throw new FriendRequestException(
                "Tài khoản không tồn tại hoặc đã bị vô hiệu hóa.",
                404);
        }
    }

    // =====================================================
    // AUDIT
    // =====================================================

    private void AddAudit(
        Guid actorId,
        Guid targetId,
        string eventType,
        Guid entityId,
        DateTime occurredAtUtc)
    {
        _db.FriendAuditLogs.Add(new FriendAuditLog
        {
            Id = Guid.NewGuid(),
            ActorUserId = actorId,
            TargetUserId = targetId,
            EventType = eventType,
            EntityId = entityId,
            OccurredAtUtc = occurredAtUtc,
            MetadataJson = null
        });
    }
}