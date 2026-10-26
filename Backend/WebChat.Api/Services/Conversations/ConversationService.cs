
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

        // SQL Server có quy tắc so sánh uniqueidentifier
        // riêng. Không sắp xếp GUID bằng chuỗi C#.

        var firstComesBefore = await db.Database
            .SqlQueryRaw<int>(
                """
                SELECT CASE
                    WHEN @userA < @userB THEN 1
                    ELSE 0
                END AS [Value]
                """,
                new SqlParameter(
                    "@userA",
                    currentUserId),
                new SqlParameter(
                    "@userB",
                    targetUserId))
            .SingleAsync(cancellationToken);

        var lowId = firstComesBefore == 1
            ? currentUserId
            : targetUserId;

        var highId = firstComesBefore == 1
            ? targetUserId
            : currentUserId;

        // =================================================
        // TRANSACTION + APPLICATION LOCK
        // =================================================

        await using var transaction =
            await db.Database.BeginTransactionAsync(
                IsolationLevel.Serializable,
                cancellationToken);

        var lockIds = new[]
        {
            currentUserId.ToString("N"),
            targetUserId.ToString("N")
        };

        Array.Sort(
            lockIds,
            StringComparer.Ordinal);

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

        // =================================================
        // VALIDATE ACTIVE USERS
        // =================================================

        var activeUsers = await db.Users
            .AsNoTracking()
            .CountAsync(
                x =>
                    (x.Id == currentUserId ||
                     x.Id == targetUserId) &&
                    x.IsActive,
                cancellationToken);

        if (activeUsers != 2)
        {
            throw new InvalidOperationException(
                "Một trong hai tài khoản không khả dụng.");
        }

        // =================================================
        // FIND EXISTING CONVERSATION
        // =================================================

        var conversation = await db.Conversations
            .AsNoTracking()
            .FirstOrDefaultAsync(
                x =>
                    x.Type == PrivateConversationType &&
                    x.PrivateUserLowId == lowId &&
                    x.PrivateUserHighId == highId,
                cancellationToken);

        // =================================================
        // CHECK FRIENDSHIP / BLOCK
        // =================================================

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

        var canSend =
            areFriends && !isBlocked;

        // =================================================
        // CREATE IF NOT EXISTS
        // =================================================

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
                    JoinedAtUtc =
                        conversation.CreatedAtUtc,
                    LastReadSequence = 0
                },
                new ConversationMember
                {
                    Id = Guid.NewGuid(),
                    ConversationId = conversation.Id,
                    UserId = targetUserId,
                    JoinedAtUtc =
                        conversation.CreatedAtUtc,
                    LastReadSequence = 0
                });

            await db.SaveChangesAsync(
                cancellationToken);
        }
        else
        {
            var memberCount =
                await db.ConversationMembers
                    .AsNoTracking()
                    .CountAsync(
                        x =>
                            x.ConversationId ==
                                conversation.Id &&
                            (x.UserId == currentUserId ||
                             x.UserId == targetUserId),
                        cancellationToken);

            if (memberCount != 2)
            {
                throw new InvalidOperationException(
                    "Dữ liệu thành viên hội thoại " +
                    "không hợp lệ.");
            }
        }

        // =================================================
        // LOAD CURRENT MEMBERSHIP / OTHER USER
        // =================================================

        var myMembership =
            await db.ConversationMembers
                .AsNoTracking()
                .SingleAsync(
                    x =>
                        x.ConversationId ==
                            conversation.Id &&
                        x.UserId == currentUserId,
                    cancellationToken);

        var otherUser = await db.Users
            .AsNoTracking()
            .SingleAsync(
                x => x.Id == targetUserId,
                cancellationToken);

        await transaction.CommitAsync(
            cancellationToken);

        // =================================================
        // UNREAD COUNT
        // =================================================

        var unreadCounts =
            await GetUnreadCountsAsync(
                currentUserId,
                [conversation.Id],
                cancellationToken);

        // =================================================
        // NEW - LAST MESSAGE PREVIEW
        // =================================================

        var previews =
            await GetLastMessagePreviewsAsync(
                [conversation.Id],
                cancellationToken);

        previews.TryGetValue(
            conversation.Id,
            out var preview);

        // =================================================
        // RETURN DTO
        // =================================================

        return MapConversation(
            conversation,
            myMembership.LastReadSequence,
            otherUser,
            canSend,
            GetCannotSendReason(
                canSend,
                areFriends,
                isBlocked,
                otherUser.IsActive),
            unreadCounts.GetValueOrDefault(
                conversation.Id),
            preview);
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

        // =================================================
        // VALIDATE ACTIVE USER
        // =================================================

        var currentUserActive = await db.Users
            .AsNoTracking()
            .AnyAsync(
                x =>
                    x.Id == currentUserId &&
                    x.IsActive,
                cancellationToken);

        if (!currentUserActive)
        {
            return null;
        }

        // =================================================
        // VALIDATE MEMBERSHIP
        // =================================================

        var membership =
            await db.ConversationMembers
                .AsNoTracking()
                .Include(x => x.Conversation)
                .FirstOrDefaultAsync(
                    x =>
                        x.ConversationId ==
                            conversationId &&
                        x.UserId == currentUserId &&
                        x.Conversation.Type ==
                            PrivateConversationType,
                    cancellationToken);

        if (membership == null)
        {
            return null;
        }

        var conversation =
            membership.Conversation;

        Guid otherUserId;

        if (
            conversation.PrivateUserLowId ==
                currentUserId
        )
        {
            otherUserId =
                conversation.PrivateUserHighId ??
                Guid.Empty;
        }
        else if (
            conversation.PrivateUserHighId ==
                currentUserId
        )
        {
            otherUserId =
                conversation.PrivateUserLowId ??
                Guid.Empty;
        }
        else
        {
            return null;
        }

        if (otherUserId == Guid.Empty)
        {
            return null;
        }

        // =================================================
        // VALIDATE OTHER MEMBERSHIP
        // =================================================

        var otherIsMember =
            await db.ConversationMembers
                .AsNoTracking()
                .AnyAsync(
                    x =>
                        x.ConversationId ==
                            conversationId &&
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

        // =================================================
        // RELATIONSHIP PERMISSIONS
        // =================================================

        var permissions =
            await GetRelationshipPermissionsAsync(
                currentUserId,
                [otherUserId],
                cancellationToken);

        var permission =
            permissions[otherUserId];

        var canSend =
            otherUser.IsActive &&
            permission.AreFriends &&
            !permission.IsBlocked;

        // =================================================
        // UNREAD COUNT
        // =================================================

        var unreadCounts =
            await GetUnreadCountsAsync(
                currentUserId,
                [conversationId],
                cancellationToken);

        // =================================================
        // NEW - LAST MESSAGE PREVIEW
        // =================================================

        var previews =
            await GetLastMessagePreviewsAsync(
                [conversationId],
                cancellationToken);

        previews.TryGetValue(
            conversationId,
            out var preview);

        // =================================================
        // RETURN DTO
        // =================================================

        return MapConversation(
            conversation,
            membership.LastReadSequence,
            otherUser,
            canSend,
            GetCannotSendReason(
                canSend,
                permission.AreFriends,
                permission.IsBlocked,
                otherUser.IsActive),
            unreadCounts.GetValueOrDefault(
                conversationId),
            preview);
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

        pageSize = Math.Clamp(
            pageSize,
            1,
            MaxPageSize);

        var response =
            new ConversationListResponse
            {
                Page = page,
                PageSize = pageSize
            };

        if (currentUserId == Guid.Empty)
        {
            return response;
        }

        // =================================================
        // VALIDATE ACTIVE USER
        // =================================================

        var currentUserActive = await db.Users
            .AsNoTracking()
            .AnyAsync(
                x =>
                    x.Id == currentUserId &&
                    x.IsActive,
                cancellationToken);

        if (!currentUserActive)
        {
            return response;
        }

        // =================================================
        // QUERY MY PRIVATE CONVERSATIONS
        // =================================================

        var query =
            db.ConversationMembers
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

        // =================================================
        // PAGINATION
        // =================================================

        var memberships = await query
            .OrderByDescending(
                x =>
                    x.Conversation.LastMessageAtUtc ??
                    x.Conversation.CreatedAtUtc)
            .ThenByDescending(
                x => x.Conversation.Id)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Include(x => x.Conversation)
            .ToListAsync(cancellationToken);

        if (memberships.Count == 0)
        {
            return response;
        }

        // =================================================
        // OTHER USER IDS
        // =================================================

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

        // =================================================
        // BATCH LOAD OTHER USERS
        // =================================================

        var otherUsers = await db.Users
            .AsNoTracking()
            .Where(
                x => otherUserIds.Contains(x.Id))
            .ToDictionaryAsync(
                x => x.Id,
                cancellationToken);

        // =================================================
        // BATCH RELATIONSHIP PERMISSIONS
        // =================================================

        var permissions =
            await GetRelationshipPermissionsAsync(
                currentUserId,
                otherUserIds,
                cancellationToken);

        // =================================================
        // CONVERSATION IDS
        // =================================================

        var conversationIds = memberships
            .Select(x => x.ConversationId)
            .Distinct()
            .ToArray();

        // =================================================
        // BATCH UNREAD COUNT
        // =================================================

        var unreadCounts =
            await GetUnreadCountsAsync(
                currentUserId,
                conversationIds,
                cancellationToken);

        // =================================================
        // NEW - BATCH LAST MESSAGE PREVIEW
        // =================================================

        // Chỉ thực hiện một query cho những
        // conversation thuộc trang hiện tại.
        //
        // Không truy vấn từng conversation
        // trong vòng foreach.

        var previews =
            await GetLastMessagePreviewsAsync(
                conversationIds,
                cancellationToken);

        // =================================================
        // MAP CONVERSATION ITEMS
        // =================================================

        foreach (var membership in memberships)
        {
            var conversation =
                membership.Conversation;

            var otherId =
                conversation.PrivateUserLowId ==
                    currentUserId
                    ? conversation.PrivateUserHighId
                    : conversation.PrivateUserLowId;

            if (
                !otherId.HasValue ||
                !otherUsers.TryGetValue(
                    otherId.Value,
                    out var otherUser)
            )
            {
                continue;
            }

            if (
                !permissions.TryGetValue(
                    otherId.Value,
                    out var permission)
            )
            {
                continue;
            }

            var canSend =
                otherUser.IsActive &&
                permission.AreFriends &&
                !permission.IsBlocked;

            previews.TryGetValue(
                conversation.Id,
                out var preview);

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
                        otherUser.IsActive),
                    unreadCounts.GetValueOrDefault(
                        conversation.Id),
                    preview));
        }

        return response;
    }

    // =====================================================
    // PHASE 5.8B - SERVER-SIDE BATCH UNREAD COUNT
    // =====================================================

    private async Task<Dictionary<Guid, int>>
        GetUnreadCountsAsync(
            Guid currentUserId,
            IReadOnlyCollection<Guid> conversationIds,
            CancellationToken cancellationToken)
    {
        if (
            currentUserId == Guid.Empty ||
            conversationIds.Count == 0
        )
        {
            return new Dictionary<Guid, int>();
        }

        var ids = conversationIds
            .Distinct()
            .ToArray();

        // Chỉ đếm tin nhắn:
        // - Thuộc hội thoại của user
        // - Do người khác gửi
        // - Sequence lớn hơn Read Cursor
        //
        // Không loại bỏ tin đã Recall.
        // Không phụ thuộc Friendship / Block.

        var counts = await (
            from member in db.ConversationMembers
                .AsNoTracking()

            join message in db.Messages
                .AsNoTracking()

                on member.ConversationId
                equals message.ConversationId

            where
                member.UserId == currentUserId &&
                member.Conversation.Type ==
                    PrivateConversationType &&
                ids.Contains(
                    member.ConversationId) &&
                message.SenderId != currentUserId &&
                message.SequenceNumber >
                    member.LastReadSequence

            group message by member.ConversationId
            into grouped

            select new
            {
                ConversationId = grouped.Key,
                Count = grouped.Count()
            }
        ).ToListAsync(cancellationToken);

        return counts.ToDictionary(
            x => x.ConversationId,
            x => x.Count);
    }

    // =====================================================
    // PHASE 5.8E3 - BATCH LAST MESSAGE PREVIEW
    // =====================================================

    private sealed record LastMessagePreview(
        Guid ConversationId,
        string? Content,
        Guid SenderId,
        bool IsRecalled);

    private async Task<
        Dictionary<Guid, LastMessagePreview>>
        GetLastMessagePreviewsAsync(
            IReadOnlyCollection<Guid> conversationIds,
            CancellationToken cancellationToken)
    {
        if (conversationIds.Count == 0)
        {
            return new Dictionary<
                Guid,
                LastMessagePreview>();
        }

        var ids = conversationIds
            .Distinct()
            .ToArray();

        // =================================================
        // FETCH LATEST MESSAGE PER CONVERSATION
        // =================================================

        // Dùng GroupBy để lấy tin nhắn có
        // SequenceNumber lớn nhất mỗi hội thoại.
        //
        // Chỉ lấy các trường cần cho preview,
        // không tải toàn bộ Message entity.
        //
        // AsNoTracking để tránh EF tracking.
        //
        // SQL Server thực hiện truy vấn trên DB.

        var messages = await db.Messages
            .AsNoTracking()
            .Where(m =>
                ids.Contains(m.ConversationId))
            .GroupBy(m => m.ConversationId)
            .Select(group => group
                .OrderByDescending(
                    m => m.SequenceNumber)
                .Select(m => new
                {
                    m.ConversationId,
                    m.Content,
                    m.SenderId,
                    m.RecalledAtUtc
                })
                .First())
            .ToListAsync(cancellationToken);

        // =================================================
        // BUILD DICTIONARY
        // =================================================

        return messages.ToDictionary(
            message => message.ConversationId,
            message => new LastMessagePreview(
                message.ConversationId,
                message.Content,
                message.SenderId,
                message.RecalledAtUtc != null));
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

        // =================================================
        // FRIENDSHIPS
        // =================================================

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

        // =================================================
        // BLOCKS
        // =================================================

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

        // =================================================
        // MAP FRIEND IDS
        // =================================================

        var friendIds = friendships
            .Select(x =>
                x.UserAId == currentUserId
                    ? x.UserBId
                    : x.UserAId)
            .ToHashSet();

        // =================================================
        // MAP BLOCKED IDS
        // =================================================

        var blockedIds = blocks
            .Select(x =>
                x.BlockerId == currentUserId
                    ? x.BlockedId
                    : x.BlockerId)
            .ToHashSet();

        // =================================================
        // BUILD PERMISSIONS
        // =================================================

        foreach (var id in ids)
        {
            result[id] =
                new RelationshipPermission(
                    friendIds.Contains(id),
                    blockedIds.Contains(id));
        }

        return result;
    }

    // =====================================================
    // MAPPING CONVERSATION DTO
    // =====================================================

    private static ConversationDto MapConversation(
        Conversation conversation,
        long lastReadSequence,
        User otherUser,
        bool canSend,
        string? cannotSendReason,
        int unreadCount = 0,
        LastMessagePreview? preview = null)
    {
        return new ConversationDto
        {
            // =================================================
            // CONVERSATION
            // =================================================

            Id = conversation.Id,
            Type = conversation.Type,

            // =================================================
            // OTHER USER
            // =================================================

            OtherUserId = otherUser.Id,
            OtherUsername = otherUser.Username,
            OtherDisplayName = otherUser.DisplayName,
            OtherAvatarUrl = otherUser.AvatarUrl,

            // =================================================
            // CONVERSATION METADATA
            // =================================================

            CreatedAtUtc =
                conversation.CreatedAtUtc,

            LastMessageAtUtc =
                conversation.LastMessageAtUtc,

            LastMessageSequence =
                conversation.LastMessageSequence,

            // =================================================
            // NEW - LAST MESSAGE PREVIEW
            // =================================================

            LastMessageContent =
                preview == null
                    ? null
                    : preview.IsRecalled
                        ? "Tin nhắn đã được thu hồi"
                        : preview.Content,

            LastMessageSenderId =
                preview?.SenderId,

            // =================================================
            // EXISTING - READ CURSOR
            // =================================================

            LastReadSequence =
                lastReadSequence,

            // =================================================
            // PHASE 5.8B - UNREAD COUNT
            // =================================================

            UnreadCount =
                unreadCount,

            // =================================================
            // EXISTING - PERMISSIONS
            // =================================================

            CanSendMessage =
                canSend,

            CannotSendReason =
                cannotSendReason
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
            return
                "Tài khoản người nhận hiện " +
                "không khả dụng.";
        }

        if (isBlocked)
        {
            return
                "Không thể gửi tin nhắn vì " +
                "một trong hai người đã chặn người kia.";
        }

        if (!areFriends)
        {
            return
                "Hai người hiện không còn là bạn bè.";
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
