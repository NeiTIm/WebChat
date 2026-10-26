
using System.Data;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using WebChat.Api.Data;
using WebChat.Api.DTOs.Conversations;
using WebChat.Api.Models;

namespace WebChat.Api.Services.Conversations;

public sealed class ConversationService(
    AppDbContext db
) : IConversationService
{
    private const byte PrivateConversationType = 1;

    private const int MaxPageSize = 50;

    // =====================================================
    // 5.4.2 - OPEN OR CREATE PRIVATE CONVERSATION
    // =====================================================

    public async Task<ConversationDto> OpenPrivateAsync(
        Guid currentUserId,
        Guid targetUserId,
        CancellationToken cancellationToken = default)
    {
        if (currentUserId == Guid.Empty ||
            targetUserId == Guid.Empty)
        {
            throw new ArgumentException(
                "UserId không hợp lệ.");
        }

        if (currentUserId == targetUserId)
        {
            throw new InvalidOperationException(
                "Không thể tạo hội thoại với chính mình.");
        }

        // SQL Server sử dụng quy tắc so sánh
        // uniqueidentifier riêng. Không sắp xếp
        // theo chuỗi GUID trong C#.
        var firstComesBefore = await db.Database
            .SqlQueryRaw<int>(
                """
                SELECT CASE
                    WHEN @userA < @userB THEN 1
                    ELSE 0
                END AS [Value]
                """,
                new SqlParameter("@userA", currentUserId),
                new SqlParameter("@userB", targetUserId))
            .SingleAsync(cancellationToken);

        var lowId = firstComesBefore == 1
            ? currentUserId
            : targetUserId;

        var highId = firstComesBefore == 1
            ? targetUserId
            : currentUserId;

        await using var transaction =
            await db.Database.BeginTransactionAsync(
                IsolationLevel.Serializable,
                cancellationToken);

        // Khóa chống hai request cùng tạo một
        // Private Conversation cho một cặp Users.
        var lockIds = new[]
        {
            currentUserId.ToString("N"),
            targetUserId.ToString("N")
        };

        Array.Sort(lockIds, StringComparer.Ordinal);

        var lockResource =
            $"WebChat:PrivateConversation:" +
            $"{lockIds[0]}:{lockIds[1]}";

        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
            DECLARE @lockResult int;

            EXEC @lockResult = sys.sp_getapplock
                @Resource = {lockResource},
                @LockMode = 'Exclusive',
                @LockOwner = 'Transaction',
                @LockTimeout = 10000;

            IF @lockResult < 0
                THROW 51000,
                    'Cannot acquire conversation lock.',
                    1;
            """,
            cancellationToken);

        var activeUsers = await db.Users
            .AsNoTracking()
            .CountAsync(
                x => (x.Id == currentUserId ||
                      x.Id == targetUserId) &&
                     x.IsActive,
                cancellationToken);

        if (activeUsers != 2)
        {
            throw new InvalidOperationException(
                "Một trong hai tài khoản không khả dụng.");
        }

        var conversation = await db.Conversations
            .AsNoTracking()
            .FirstOrDefaultAsync(
                x => x.Type == PrivateConversationType &&
                     x.PrivateUserLowId == lowId &&
                     x.PrivateUserHighId == highId,
                cancellationToken);

        var areFriends = await db.Friendships
            .AsNoTracking()
            .AnyAsync(
                x =>
                    (x.UserAId == currentUserId &&
                     x.UserBId == targetUserId) ||
                    (x.UserAId == targetUserId &&
                     x.UserBId == currentUserId),
                cancellationToken);

        var isBlocked = await db.UserBlocks
            .AsNoTracking()
            .AnyAsync(
                x =>
                    (x.BlockerId == currentUserId &&
                     x.BlockedId == targetUserId) ||
                    (x.BlockerId == targetUserId &&
                     x.BlockedId == currentUserId),
                cancellationToken);

        var canSend = areFriends && !isBlocked;

        if (conversation == null)
        {
            if (!canSend)
            {
                throw new InvalidOperationException(
                    "Chỉ bạn bè không bị chặn mới " +
                    "được bắt đầu cuộc trò chuyện.");
            }

            conversation = new Conversation
            {
                Id = Guid.NewGuid(),
                Type = PrivateConversationType,
                PrivateUserLowId = lowId,
                PrivateUserHighId = highId,
                CreatedByUserId = currentUserId,
                CreatedAtUtc = DateTime.UtcNow,
                LastMessageSequence = 0
            };

            db.Conversations.Add(conversation);

            db.ConversationMembers.AddRange(
                new ConversationMember
                {
                    Id = Guid.NewGuid(),
                    ConversationId = conversation.Id,
                    UserId = currentUserId,
                    JoinedAtUtc = conversation.CreatedAtUtc,
                    LastReadSequence = 0
                },
                new ConversationMember
                {
                    Id = Guid.NewGuid(),
                    ConversationId = conversation.Id,
                    UserId = targetUserId,
                    JoinedAtUtc = conversation.CreatedAtUtc,
                    LastReadSequence = 0
                });

            await db.SaveChangesAsync(cancellationToken);
        }
        else
        {
            var memberCount = await db.ConversationMembers
                .AsNoTracking()
                .CountAsync(
                    x => x.ConversationId == conversation.Id &&
                         (x.UserId == currentUserId ||
                          x.UserId == targetUserId),
                    cancellationToken);

            if (memberCount != 2)
            {
                throw new InvalidOperationException(
                    "Dữ liệu thành viên hội thoại không hợp lệ.");
            }
        }

        var myMembership = await db.ConversationMembers
            .AsNoTracking()
            .SingleAsync(
                x => x.ConversationId == conversation.Id &&
                     x.UserId == currentUserId,
                cancellationToken);

        var otherUser = await db.Users
            .AsNoTracking()
            .SingleAsync(
                x => x.Id == targetUserId,
                cancellationToken);

        await transaction.CommitAsync(cancellationToken);

        return MapConversation(
            conversation,
            myMembership.LastReadSequence,
            otherUser,
            canSend,
            GetCannotSendReason(
                canSend,
                areFriends,
                isBlocked,
                otherUser.IsActive));
    }

    // =====================================================
    // 5.4.3 - GET CONVERSATION DETAILS
    // =====================================================

    public async Task<ConversationDto?> GetByIdAsync(
        Guid conversationId,
        Guid currentUserId,
        CancellationToken cancellationToken = default)
    {
        if (conversationId == Guid.Empty ||
            currentUserId == Guid.Empty)
        {
            return null;
        }

        // Không cho tài khoản inactive sử dụng Service.
        var currentUserActive = await db.Users
            .AsNoTracking()
            .AnyAsync(
                x => x.Id == currentUserId && x.IsActive,
                cancellationToken);

        if (!currentUserActive)
        {
            return null;
        }

        // Kiểm tra membership ngay trong truy vấn.
        // Không cho người ngoài xem Conversation.
        var membership = await db.ConversationMembers
            .AsNoTracking()
            .Include(x => x.Conversation)
            .FirstOrDefaultAsync(
                x => x.ConversationId == conversationId &&
                     x.UserId == currentUserId &&
                     x.Conversation.Type ==
                         PrivateConversationType,
                cancellationToken);

        if (membership == null)
        {
            return null;
        }

        var conversation = membership.Conversation;

        Guid otherUserId;

        if (conversation.PrivateUserLowId == currentUserId)
        {
            otherUserId =
                conversation.PrivateUserHighId ?? Guid.Empty;
        }
        else if (
            conversation.PrivateUserHighId == currentUserId)
        {
            otherUserId =
                conversation.PrivateUserLowId ?? Guid.Empty;
        }
        else
        {
            return null;
        }

        if (otherUserId == Guid.Empty)
        {
            return null;
        }

        // Phải tồn tại membership của người còn lại.
        var otherIsMember = await db.ConversationMembers
            .AsNoTracking()
            .AnyAsync(
                x => x.ConversationId == conversationId &&
                     x.UserId == otherUserId,
                cancellationToken);

        if (!otherIsMember)
        {
            return null;
        }

        var otherUser = await db.Users
            .AsNoTracking()
            .FirstOrDefaultAsync(
                x => x.Id == otherUserId,
                cancellationToken);

        if (otherUser == null)
        {
            return null;
        }

        // Tính lại quyền gửi từ dữ liệu hiện tại.
        var permissions = await GetRelationshipPermissionsAsync(
            currentUserId,
            [otherUserId],
            cancellationToken);

        var permission = permissions[otherUserId];

        var canSend =
            otherUser.IsActive &&
            permission.AreFriends &&
            !permission.IsBlocked;

        return MapConversation(
            conversation,
            membership.LastReadSequence,
            otherUser,
            canSend,
            GetCannotSendReason(
                canSend,
                permission.AreFriends,
                permission.IsBlocked,
                otherUser.IsActive));
    }

    // =====================================================
    // 5.4.3 - GET MY CONVERSATIONS
    // =====================================================

    public async Task<ConversationListResponse>
        GetMyConversationsAsync(
            Guid currentUserId,
            int page,
            int pageSize,
            CancellationToken cancellationToken = default)
    {
        page = Math.Max(page, 1);
        pageSize = Math.Clamp(pageSize, 1, MaxPageSize);

        var response = new ConversationListResponse
        {
            Page = page,
            PageSize = pageSize
        };

        if (currentUserId == Guid.Empty)
        {
            return response;
        }

        var currentUserActive = await db.Users
            .AsNoTracking()
            .AnyAsync(
                x => x.Id == currentUserId && x.IsActive,
                cancellationToken);

        if (!currentUserActive)
        {
            return response;
        }

        // Chỉ lấy những hội thoại mình là thành viên
        // và có cặp Private Users hợp lệ.
        var query = db.ConversationMembers
            .AsNoTracking()
            .Where(x =>
                x.UserId == currentUserId &&
                x.Conversation.Type ==
                    PrivateConversationType &&
                (
                    x.Conversation.PrivateUserLowId ==
                        currentUserId ||
                    x.Conversation.PrivateUserHighId ==
                        currentUserId
                ));

        response.Total = await query.CountAsync(
            cancellationToken);

        response.TotalPages =
            (int)Math.Ceiling(
                response.Total / (double)pageSize);

        if (response.Total == 0)
        {
            return response;
        }

        var memberships = await query
            .OrderByDescending(
                x => x.Conversation.LastMessageAtUtc ??
                     x.Conversation.CreatedAtUtc)
            .ThenByDescending(x => x.Conversation.Id)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Include(x => x.Conversation)
            .ToListAsync(cancellationToken);

        if (memberships.Count == 0)
        {
            return response;
        }

        // Xác định người còn lại trong từng hội thoại.
        var otherUserIds = memberships
            .Select(x =>
                x.Conversation.PrivateUserLowId ==
                    currentUserId
                    ? x.Conversation.PrivateUserHighId
                    : x.Conversation.PrivateUserLowId)
            .Where(x => x.HasValue)
            .Select(x => x!.Value)
            .Distinct()
            .ToList();

        // Batch query, tránh N+1 queries.
        var otherUsers = await db.Users
            .AsNoTracking()
            .Where(x => otherUserIds.Contains(x.Id))
            .ToDictionaryAsync(
                x => x.Id,
                cancellationToken);

        var permissions =
            await GetRelationshipPermissionsAsync(
                currentUserId,
                otherUserIds,
                cancellationToken);

        foreach (var membership in memberships)
        {
            var conversation = membership.Conversation;

            var otherId =
                conversation.PrivateUserLowId ==
                    currentUserId
                    ? conversation.PrivateUserHighId
                    : conversation.PrivateUserLowId;

            if (!otherId.HasValue ||
                !otherUsers.TryGetValue(
                    otherId.Value,
                    out var otherUser))
            {
                continue;
            }

            if (!permissions.TryGetValue(
                    otherId.Value,
                    out var permission))
            {
                continue;
            }

            var canSend =
                otherUser.IsActive &&
                permission.AreFriends &&
                !permission.IsBlocked;

            response.Items.Add(
                MapConversation(
                    conversation,
                    membership.LastReadSequence,
                    otherUser,
                    canSend,
                    GetCannotSendReason(
                        canSend,
                        permission.AreFriends,
                        permission.IsBlocked,
                        otherUser.IsActive)));
        }

        return response;
    }

    // =====================================================
    // RELATIONSHIP PERMISSIONS - BATCH QUERY
    // =====================================================

    private async Task<
        Dictionary<Guid, RelationshipPermission>>
        GetRelationshipPermissionsAsync(
            Guid currentUserId,
            IReadOnlyCollection<Guid> otherUserIds,
            CancellationToken cancellationToken)
    {
        var result = otherUserIds
            .Distinct()
            .ToDictionary(
                id => id,
                _ => new RelationshipPermission(
                    false,
                    false));

        if (result.Count == 0)
        {
            return result;
        }

        var ids = result.Keys.ToList();

        // Kiểm tra Friendship hai chiều.
        var friendships = await db.Friendships
            .AsNoTracking()
            .Where(x =>
                (x.UserAId == currentUserId &&
                 ids.Contains(x.UserBId)) ||
                (x.UserBId == currentUserId &&
                 ids.Contains(x.UserAId)))
            .Select(x => new
            {
                x.UserAId,
                x.UserBId
            })
            .ToListAsync(cancellationToken);

        // Kiểm tra Block cả hai chiều.
        var blocks = await db.UserBlocks
            .AsNoTracking()
            .Where(x =>
                (x.BlockerId == currentUserId &&
                 ids.Contains(x.BlockedId)) ||
                (x.BlockedId == currentUserId &&
                 ids.Contains(x.BlockerId)))
            .Select(x => new
            {
                x.BlockerId,
                x.BlockedId
            })
            .ToListAsync(cancellationToken);

        var friendIds = friendships
            .Select(x =>
                x.UserAId == currentUserId
                    ? x.UserBId
                    : x.UserAId)
            .ToHashSet();

        var blockedIds = blocks
            .Select(x =>
                x.BlockerId == currentUserId
                    ? x.BlockedId
                    : x.BlockerId)
            .ToHashSet();

        foreach (var id in ids)
        {
            result[id] = new RelationshipPermission(
                friendIds.Contains(id),
                blockedIds.Contains(id));
        }

        return result;
    }

    // =====================================================
    // MAPPING DTO
    // =====================================================

    private static ConversationDto MapConversation(
        Conversation conversation,
        long lastReadSequence,
        User otherUser,
        bool canSend,
        string? cannotSendReason)
    {
        return new ConversationDto
        {
            Id = conversation.Id,
            Type = conversation.Type,

            OtherUserId = otherUser.Id,
            OtherUsername = otherUser.Username,
            OtherDisplayName = otherUser.DisplayName,
            OtherAvatarUrl = otherUser.AvatarUrl,

            CreatedAtUtc = conversation.CreatedAtUtc,
            LastMessageAtUtc =
                conversation.LastMessageAtUtc,

            LastMessageSequence =
                conversation.LastMessageSequence,

            LastReadSequence =
                lastReadSequence,

            CanSendMessage = canSend,
            CannotSendReason = cannotSendReason
        };
    }

    // =====================================================
    // REASON WHEN SENDING IS DISABLED
    // =====================================================

    private static string? GetCannotSendReason(
        bool canSend,
        bool areFriends,
        bool isBlocked,
        bool otherUserActive)
    {
        if (canSend)
        {
            return null;
        }

        if (!otherUserActive)
        {
            return "Tài khoản người nhận hiện không khả dụng.";
        }

        if (isBlocked)
        {
            return "Không thể gửi tin nhắn vì một trong " +
                   "hai người đã chặn người kia.";
        }

        if (!areFriends)
        {
            return "Hai người hiện không còn là bạn bè.";
        }

        return "Hiện không thể gửi tin nhắn.";
    }

    // =====================================================
    // INTERNAL DATA
    // =====================================================

    private sealed record RelationshipPermission(
        bool AreFriends,
        bool IsBlocked);
}
