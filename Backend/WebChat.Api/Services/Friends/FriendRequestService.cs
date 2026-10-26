using Microsoft.EntityFrameworkCore;
using WebChat.Api.Data;
using WebChat.Api.DTOs.Friends;
using WebChat.Api.Models;

namespace WebChat.Api.Services.Friends;

public sealed class FriendRequestService : IFriendRequestService
{
    private readonly AppDbContext _db;

    public FriendRequestService(AppDbContext db)
    {
        _db = db;
    }

    // =====================================================
    // 1. SEND FRIEND REQUEST
    // =====================================================

    public async Task<FriendRequestResponse> SendAsync(
        Guid senderId,
        Guid receiverId,
        CancellationToken ct = default)
    {
        if (senderId == Guid.Empty || receiverId == Guid.Empty)
        {
            throw new FriendRequestException(
                "Người gửi hoặc người nhận không hợp lệ.",
                400);
        }

        if (senderId == receiverId)
        {
            throw new FriendRequestException(
                "Bạn không thể tự gửi lời mời kết bạn.",
                400);
        }

        await using var tx =
            await _db.Database.BeginTransactionAsync(ct);

        // Khóa chung với Friendship và Block.
        await FriendPairLock.AcquireAsync(
            _db,
            senderId,
            receiverId,
            ct);

        await EnsureActiveUsersAsync(
            senderId,
            receiverId,
            ct);

        await EnsureNotBlockedAsync(
            senderId,
            receiverId,
            ct);

        if (await FriendshipExistsAsync(
            senderId,
            receiverId,
            ct))
        {
            throw new FriendRequestException(
                "Hai người đã là bạn bè.",
                409);
        }

        var pendingExists = await _db.FriendRequests
            .AsNoTracking()
            .AnyAsync(
                x =>
                    x.Status == FriendRequestStatus.Pending &&
                    (
                        (x.SenderId == senderId &&
                         x.ReceiverId == receiverId)
                        ||
                        (x.SenderId == receiverId &&
                         x.ReceiverId == senderId)
                    ),
                ct);

        if (pendingExists)
        {
            throw new FriendRequestException(
                "Giữa hai người đã có lời mời đang chờ.",
                409);
        }

        var now = DateTime.UtcNow;

        var request = new FriendRequest
        {
            Id = Guid.NewGuid(),
            SenderId = senderId,
            ReceiverId = receiverId,
            Status = FriendRequestStatus.Pending,
            CreatedAtUtc = now
        };

        _db.FriendRequests.Add(request);

        AddAudit(
            senderId,
            receiverId,
            "FriendRequest.Sent",
            request.Id,
            now);

        await _db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);

        return await BuildResponseAsync(request, ct);
    }

    // =====================================================
    // 2. GET RECEIVED REQUESTS
    // =====================================================

    public Task<FriendRequestListResponse> GetReceivedAsync(
        Guid userId,
        int page,
        int pageSize,
        CancellationToken ct = default)
    {
        var query = _db.FriendRequests
            .AsNoTracking()
            .Where(x =>
                x.ReceiverId == userId &&
                x.Status == FriendRequestStatus.Pending);

        return BuildListAsync(
            query,
            page,
            pageSize,
            ct);
    }

    // =====================================================
    // 3. GET SENT REQUESTS
    // =====================================================

    public Task<FriendRequestListResponse> GetSentAsync(
        Guid userId,
        int page,
        int pageSize,
        CancellationToken ct = default)
    {
        var query = _db.FriendRequests
            .AsNoTracking()
            .Where(x =>
                x.SenderId == userId &&
                x.Status == FriendRequestStatus.Pending);

        return BuildListAsync(
            query,
            page,
            pageSize,
            ct);
    }

    // =====================================================
    // 4. ACCEPT FRIEND REQUEST
    // =====================================================

    public async Task<FriendRequestResponse> AcceptAsync(
        Guid requestId,
        Guid currentUserId,
        CancellationToken ct = default)
    {
        // Chỉ người nhận mới được chấp nhận.
        var initial = await _db.FriendRequests
            .AsNoTracking()
            .Where(x =>
                x.Id == requestId &&
                x.ReceiverId == currentUserId)
            .Select(x => new
            {
                x.SenderId,
                x.ReceiverId
            })
            .FirstOrDefaultAsync(ct);

        if (initial is null)
        {
            throw new FriendRequestException(
                "Không tìm thấy lời mời.",
                404);
        }

        await using var tx =
            await _db.Database.BeginTransactionAsync(ct);

        await FriendPairLock.AcquireAsync(
            _db,
            initial.SenderId,
            initial.ReceiverId,
            ct);

        // Đọc lại sau khi lấy Pair Lock.
        var request = await _db.FriendRequests
            .FirstOrDefaultAsync(
                x =>
                    x.Id == requestId &&
                    x.ReceiverId == currentUserId,
                ct);

        if (request is null)
        {
            throw new FriendRequestException(
                "Không tìm thấy lời mời.",
                404);
        }

        EnsurePending(request);

        await EnsureActiveUsersAsync(
            request.SenderId,
            request.ReceiverId,
            ct);

        await EnsureNotBlockedAsync(
            request.SenderId,
            request.ReceiverId,
            ct);

        if (await FriendshipExistsAsync(
            request.SenderId,
            request.ReceiverId,
            ct))
        {
            throw new FriendRequestException(
                "Hai người đã là bạn bè.",
                409);
        }

        var now = DateTime.UtcNow;

        request.Status = FriendRequestStatus.Accepted;
        request.RespondedAtUtc = now;
        request.CancelledAtUtc = null;

        var friendship = new Friendship
        {
            Id = Guid.NewGuid(),
            UserAId = request.SenderId,
            UserBId = request.ReceiverId,
            CreatedAtUtc = now
        };

        _db.Friendships.Add(friendship);

        AddAudit(
            currentUserId,
            request.SenderId,
            "FriendRequest.Accepted",
            request.Id,
            now);

        AddAudit(
            currentUserId,
            request.SenderId,
            "Friendship.Created",
            friendship.Id,
            now);

        await _db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);

        return await BuildResponseAsync(request, ct);
    }

    // =====================================================
    // 5. REJECT FRIEND REQUEST
    // =====================================================

    public async Task<FriendRequestResponse> RejectAsync(
        Guid requestId,
        Guid currentUserId,
        CancellationToken ct = default)
    {
        var initial = await _db.FriendRequests
            .AsNoTracking()
            .Where(x =>
                x.Id == requestId &&
                x.ReceiverId == currentUserId)
            .Select(x => new
            {
                x.SenderId,
                x.ReceiverId
            })
            .FirstOrDefaultAsync(ct);

        if (initial is null)
        {
            throw new FriendRequestException(
                "Không tìm thấy lời mời.",
                404);
        }

        await using var tx =
            await _db.Database.BeginTransactionAsync(ct);

        await FriendPairLock.AcquireAsync(
            _db,
            initial.SenderId,
            initial.ReceiverId,
            ct);

        var request = await _db.FriendRequests
            .FirstOrDefaultAsync(
                x =>
                    x.Id == requestId &&
                    x.ReceiverId == currentUserId,
                ct);

        if (request is null)
        {
            throw new FriendRequestException(
                "Không tìm thấy lời mời.",
                404);
        }

        EnsurePending(request);

        var now = DateTime.UtcNow;

        request.Status = FriendRequestStatus.Rejected;
        request.RespondedAtUtc = now;
        request.CancelledAtUtc = null;

        AddAudit(
            currentUserId,
            request.SenderId,
            "FriendRequest.Rejected",
            request.Id,
            now);

        await _db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);

        return await BuildResponseAsync(request, ct);
    }

    // =====================================================
    // 6. CANCEL FRIEND REQUEST
    // =====================================================

    public async Task<FriendRequestResponse> CancelAsync(
        Guid requestId,
        Guid currentUserId,
        CancellationToken ct = default)
    {
        // Chỉ người gửi mới được hủy lời mời.
        var initial = await _db.FriendRequests
            .AsNoTracking()
            .Where(x =>
                x.Id == requestId &&
                x.SenderId == currentUserId)
            .Select(x => new
            {
                x.SenderId,
                x.ReceiverId
            })
            .FirstOrDefaultAsync(ct);

        if (initial is null)
        {
            throw new FriendRequestException(
                "Không tìm thấy lời mời.",
                404);
        }

        await using var tx =
            await _db.Database.BeginTransactionAsync(ct);

        await FriendPairLock.AcquireAsync(
            _db,
            initial.SenderId,
            initial.ReceiverId,
            ct);

        var request = await _db.FriendRequests
            .FirstOrDefaultAsync(
                x =>
                    x.Id == requestId &&
                    x.SenderId == currentUserId,
                ct);

        if (request is null)
        {
            throw new FriendRequestException(
                "Không tìm thấy lời mời.",
                404);
        }

        EnsurePending(request);

        var now = DateTime.UtcNow;

        request.Status = FriendRequestStatus.Cancelled;
        request.CancelledAtUtc = now;
        request.RespondedAtUtc = null;

        AddAudit(
            currentUserId,
            request.ReceiverId,
            "FriendRequest.Cancelled",
            request.Id,
            now);

        await _db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);

        return await BuildResponseAsync(request, ct);
    }

    // =====================================================
    // 7. VALIDATE ACTIVE USERS
    // =====================================================

    private async Task EnsureActiveUsersAsync(
        Guid userA,
        Guid userB,
        CancellationToken ct)
    {
        var count = await _db.Users
            .AsNoTracking()
            .CountAsync(
                x =>
                    (x.Id == userA || x.Id == userB) &&
                    x.IsActive,
                ct);

        if (count != 2)
        {
            throw new FriendRequestException(
                "Một trong hai tài khoản không tồn tại " +
                "hoặc đã bị vô hiệu hóa.",
                404);
        }
    }

    // =====================================================
    // 8. VALIDATE BLOCK
    // =====================================================

    private async Task EnsureNotBlockedAsync(
        Guid userA,
        Guid userB,
        CancellationToken ct)
    {
        var blocked = await _db.UserBlocks
            .AsNoTracking()
            .AnyAsync(
                x =>
                    (x.BlockerId == userA &&
                     x.BlockedId == userB)
                    ||
                    (x.BlockerId == userB &&
                     x.BlockedId == userA),
                ct);

        if (blocked)
        {
            throw new FriendRequestException(
                "Không thể thực hiện lời mời kết bạn " +
                "giữa hai tài khoản này.",
                409);
        }
    }

    // =====================================================
    // 9. CHECK FRIENDSHIP
    // =====================================================

    private Task<bool> FriendshipExistsAsync(
        Guid userA,
        Guid userB,
        CancellationToken ct)
    {
        return _db.Friendships
            .AsNoTracking()
            .AnyAsync(
                x =>
                    (x.UserAId == userA &&
                     x.UserBId == userB)
                    ||
                    (x.UserAId == userB &&
                     x.UserBId == userA),
                ct);
    }

    // =====================================================
    // 10. ENSURE PENDING
    // =====================================================

    private static void EnsurePending(FriendRequest request)
    {
        if (request.Status != FriendRequestStatus.Pending)
        {
            throw new FriendRequestException(
                "Lời mời đã được xử lý trước đó.",
                409);
        }
    }

    // =====================================================
    // 11. AUDIT
    // =====================================================

    private void AddAudit(
        Guid actorUserId,
        Guid targetUserId,
        string eventType,
        Guid entityId,
        DateTime occurredAtUtc)
    {
        _db.FriendAuditLogs.Add(new FriendAuditLog
        {
            Id = Guid.NewGuid(),
            ActorUserId = actorUserId,
            TargetUserId = targetUserId,
            EventType = eventType,
            EntityId = entityId,
            OccurredAtUtc = occurredAtUtc,
            MetadataJson = null
        });
    }

    // =====================================================
    // 12. PAGINATION
    // =====================================================

    private async Task<FriendRequestListResponse> BuildListAsync(
        IQueryable<FriendRequest> query,
        int page,
        int pageSize,
        CancellationToken ct)
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
                "PageSize phải từ 20 đến 50.",
                400);
        }

        var total = await query.CountAsync(ct);

        var requests = await query
            .OrderByDescending(x => x.CreatedAtUtc)
            .ThenBy(x => x.Id)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(ct);

        var responses = await BuildResponsesAsync(
            requests,
            ct);

        var totalPages = total == 0
            ? 0
            : (int)Math.Ceiling(
                (double)total / pageSize);

        return new FriendRequestListResponse
        {
            Items = responses,
            Page = page,
            PageSize = pageSize,
            Total = total,
            TotalPages = totalPages,
            HasPreviousPage = page > 1,
            HasNextPage = page < totalPages
        };
    }

    // =====================================================
    // 13. BUILD SINGLE RESPONSE
    // =====================================================

    private async Task<FriendRequestResponse> BuildResponseAsync(
        FriendRequest request,
        CancellationToken ct)
    {
        var responses = await BuildResponsesAsync(
            new List<FriendRequest> { request },
            ct);

        return responses[0];
    }

    // =====================================================
    // 14. BUILD MULTIPLE RESPONSES
    // =====================================================

    private async Task<List<FriendRequestResponse>> BuildResponsesAsync(
        List<FriendRequest> requests,
        CancellationToken ct)
    {
        if (requests.Count == 0)
        {
            return new List<FriendRequestResponse>();
        }

        var ids = requests
            .SelectMany(x => new[]
            {
                x.SenderId,
                x.ReceiverId
            })
            .Distinct()
            .ToList();

        // Lấy User một lần, tránh N+1 queries.
        var users = await _db.Users
            .AsNoTracking()
            .Where(x => ids.Contains(x.Id))
            .Select(x => new FriendRequestUserDto
            {
                Id = x.Id,
                Username = x.Username,
                DisplayName = x.DisplayName,
                AvatarUrl = x.AvatarUrl
            })
            .ToDictionaryAsync(x => x.Id, ct);

        FriendRequestUserDto GetUser(Guid id)
        {
            return users.TryGetValue(id, out var user)
                ? user
                : new FriendRequestUserDto
                {
                    Id = id
                };
        }

        return requests
            .Select(x => new FriendRequestResponse
            {
                Id = x.Id,
                SenderId = x.SenderId,
                ReceiverId = x.ReceiverId,
                Status = x.Status.ToString(),
                CreatedAtUtc = x.CreatedAtUtc,
                RespondedAtUtc = x.RespondedAtUtc,
                CancelledAtUtc = x.CancelledAtUtc,
                Sender = GetUser(x.SenderId),
                Receiver = GetUser(x.ReceiverId)
            })
            .ToList();
    }
}