using Microsoft.EntityFrameworkCore;
using WebChat.Api.Data;
using WebChat.Api.DTOs.Friends;
using WebChat.Api.Models;

namespace WebChat.Api.Services.Friends;

public sealed class FriendStatusService : IFriendStatusService
{
    private readonly AppDbContext _db;

    public FriendStatusService(AppDbContext db)
    {
        _db = db;
    }

    public async Task<FriendStatusesResponse> GetStatusesAsync(
        Guid currentUserId,
        IReadOnlyCollection<Guid> userIds,
        CancellationToken ct = default)
    {
        if (currentUserId == Guid.Empty)
        {
            throw new ArgumentException(
                "Tài khoản hiện tại không hợp lệ.");
        }

        if (userIds.Count > 50)
        {
            throw new ArgumentException(
                "Chỉ được kiểm tra tối đa 50 người dùng mỗi lần.");
        }

        if (userIds.Any(id => id == Guid.Empty))
        {
            throw new ArgumentException(
                "Danh sách người dùng chứa ID không hợp lệ.");
        }

        var ids = userIds
            .Where(id => id != currentUserId)
            .Distinct()
            .ToList();

        if (ids.Count == 0)
        {
            return new FriendStatusesResponse();
        }

        // Chỉ cung cấp trạng thái cho tài khoản Active.
        var activeIds = await _db.Users
            .AsNoTracking()
            .Where(x => x.IsActive && ids.Contains(x.Id))
            .Select(x => x.Id)
            .ToListAsync(ct);

        var activeSet = activeIds.ToHashSet();

        var result = ids
            .Where(activeSet.Contains)
            .ToDictionary(
                id => id,
                id => new FriendStatusItemResponse
                {
                    UserId = id,
                    Status = "None"
                });

        if (result.Count == 0)
        {
            return new FriendStatusesResponse();
        }

        // =================================================
        // 1. FRIENDSHIPS
        // =================================================

        var friendships = await _db.Friendships
            .AsNoTracking()
            .Where(x =>
                (x.UserAId == currentUserId &&
                 activeIds.Contains(x.UserBId))
                ||
                (x.UserBId == currentUserId &&
                 activeIds.Contains(x.UserAId)))
            .Select(x => new
            {
                x.UserAId,
                x.UserBId
            })
            .ToListAsync(ct);

        foreach (var friendship in friendships)
        {
            var otherId =
                friendship.UserAId == currentUserId
                    ? friendship.UserBId
                    : friendship.UserAId;

            result[otherId].Status = "Friend";
        }

        // =================================================
        // 2. PENDING FRIEND REQUESTS
        // =================================================

        var pendingRequests = await _db.FriendRequests
            .AsNoTracking()
            .Where(x =>
                x.Status == FriendRequestStatus.Pending
                &&
                (
                    (x.SenderId == currentUserId &&
                     activeIds.Contains(x.ReceiverId))
                    ||
                    (x.ReceiverId == currentUserId &&
                     activeIds.Contains(x.SenderId))
                ))
            .Select(x => new
            {
                x.Id,
                x.SenderId,
                x.ReceiverId
            })
            .ToListAsync(ct);

        foreach (var request in pendingRequests)
        {
            var sentByMe = request.SenderId == currentUserId;

            var otherId = sentByMe
                ? request.ReceiverId
                : request.SenderId;

            // Friendship ưu tiên hơn Pending nếu dữ liệu
            // từng bị sai lệch do một thao tác trước đó.
            if (result[otherId].Status == "Friend")
            {
                continue;
            }

            result[otherId].Status = sentByMe
                ? "PendingSent"
                : "PendingReceived";

            result[otherId].RequestId = request.Id;
        }

        // =================================================
        // 3. BLOCKS - PRIORITY HIGHEST
        // =================================================

        var blocks = await _db.UserBlocks
            .AsNoTracking()
            .Where(x =>
                (x.BlockerId == currentUserId &&
                 activeIds.Contains(x.BlockedId))
                ||
                (x.BlockedId == currentUserId &&
                 activeIds.Contains(x.BlockerId)))
            .Select(x => new
            {
                x.BlockerId,
                x.BlockedId
            })
            .ToListAsync(ct);

        foreach (var block in blocks)
        {
            var blockedByMe = block.BlockerId == currentUserId;

            var otherId = blockedByMe
                ? block.BlockedId
                : block.BlockerId;

            // Không công khai ai đã chặn mình:
            // Unavailable chỉ thể hiện thao tác kết bạn
            // hiện không thể thực hiện.
            //
            // Nếu cả hai cùng chặn, giữ Blocked
            // để người dùng vẫn có thể tự bỏ chặn.
            if (blockedByMe)
            {
                result[otherId].Status = "Blocked";
            }
            else if (result[otherId].Status != "Blocked")
            {
                result[otherId].Status = "Unavailable";
            }

            result[otherId].RequestId = null;
        }

        return new FriendStatusesResponse
        {
            Items = ids
                .Where(result.ContainsKey)
                .Select(id => result[id])
                .ToList()
        };
    }
}