
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

using WebChat.Api.Data;
using WebChat.Api.DTOs.Messages;
using WebChat.Api.Hubs;

namespace WebChat.Api.Realtime;

public sealed class ChatRealtimePublisher(
    AppDbContext db,
    IHubContext<ChatHub> hubContext,
    IPresenceService presenceService,
    ILogger<ChatRealtimePublisher> logger
) : IChatRealtimePublisher
{
    private const byte PrivateConversationType = 1;

    // =====================================================
    // 5.7 - MESSAGE CREATED
    // =====================================================

    public async Task PublishMessageCreatedAsync(
        MessageDto message,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(message);

        if (
            message.Id == Guid.Empty ||
            message.ConversationId == Guid.Empty ||
            message.SenderId == Guid.Empty
        )
        {
            throw new ArgumentException(
                "MessageDto không hợp lệ.",
                nameof(message));
        }

        var recipients = await GetPrivateRecipientsAsync(
            message.ConversationId,
            cancellationToken);

        if (
            recipients is null ||
            !recipients.Contains(message.SenderId)
        )
        {
            logger.LogWarning(
                "Skip MessageCreated: invalid private " +
                "conversation membership. " +
                "ConversationId={ConversationId}, " +
                "MessageId={MessageId}",
                message.ConversationId,
                message.Id);

            return;
        }

        var userIds = recipients
            .Select(id => id.ToString("D"))
            .ToArray();

        // Tin nhắn đã lưu thành công trong SQL.
        await hubContext.Clients
            .Users(userIds)
            .SendAsync(
                "MessageCreated",
                message,
                cancellationToken);

        // Yêu cầu cập nhật danh sách hội thoại.
        await hubContext.Clients
            .Users(userIds)
            .SendAsync(
                "ConversationUpdated",
                new
                {
                    ConversationId = message.ConversationId,
                    LastMessageSequence =
                        message.SequenceNumber,
                    LastMessageAtUtc =
                        message.CreatedAtUtc
                },
                cancellationToken);
    }

    // =====================================================
    // 5.7 - CONVERSATION PERMISSION CHANGED
    // =====================================================

    public async Task PublishConversationPermissionChangedAsync(
        Guid conversationId,
        CancellationToken cancellationToken = default)
    {
        if (conversationId == Guid.Empty)
        {
            throw new ArgumentException(
                "ConversationId không hợp lệ.",
                nameof(conversationId));
        }

        var recipients = await GetPrivateRecipientsAsync(
            conversationId,
            cancellationToken);

        if (recipients is null)
        {
            return;
        }

        var userIds = recipients
            .Select(id => id.ToString("D"))
            .ToArray();

        await hubContext.Clients
            .Users(userIds)
            .SendAsync(
                "ConversationPermissionChanged",
                new
                {
                    ConversationId = conversationId
                },
                cancellationToken);
    }

    // =====================================================
    // 5.7.8A - FRIEND REQUEST CHANGED
    // =====================================================

    public async Task PublishFriendRequestChangedAsync(
        Guid senderUserId,
        Guid receiverUserId,
        Guid requestId,
        string action,
        CancellationToken cancellationToken = default)
    {
        ValidateUserPair(
            senderUserId,
            receiverUserId);

        if (requestId == Guid.Empty)
        {
            throw new ArgumentException(
                "RequestId không hợp lệ.",
                nameof(requestId));
        }

        if (action is not (
            "sent" or
            "accepted" or
            "rejected" or
            "cancelled"))
        {
            throw new ArgumentException(
                "Friend request action không hợp lệ.",
                nameof(action));
        }

        var actorUserId =
            action is "sent" or "cancelled"
                ? senderUserId
                : receiverUserId;

        var payload = new
        {
            EventId = Guid.NewGuid(),
            Action = action,
            RequestId = requestId,
            SenderUserId = senderUserId,
            ReceiverUserId = receiverUserId,
            ActorUserId = actorUserId,
            OccurredAtUtc = DateTime.UtcNow
        };

        var recipients = new[]
        {
            senderUserId.ToString("D"),
            receiverUserId.ToString("D")
        };

        await hubContext.Clients
            .Users(recipients)
            .SendAsync(
                "FriendRequestChanged",
                payload,
                cancellationToken);

        logger.LogInformation(
            "FriendRequestChanged published. " +
            "Action={Action}, RequestId={RequestId}",
            action,
            requestId);
    }

    // =====================================================
    // 5.7.8A + 5.7.8D1 - FRIENDSHIP CHANGED
    // =====================================================

    public async Task PublishFriendshipChangedAsync(
        Guid actorUserId,
        Guid targetUserId,
        string action,
        CancellationToken cancellationToken = default)
    {
        ValidateUserPair(
            actorUserId,
            targetUserId);

        if (action is not (
            "created" or
            "removed" or
            "blocked" or
            "unblocked"))
        {
            throw new ArgumentException(
                "Friendship action không hợp lệ.",
                nameof(action));
        }

        // =================================================
        // 1. REVOKE PRESENCE AFTER BLOCK / UNFRIEND
        // =================================================

        if (
            action == "removed" ||
            action == "blocked"
        )
        {
            try
            {
                // Gỡ đăng ký theo dõi cả hai chiều
                // khi Friendship hoặc quyền xem bị mất.
                //
                // RevokeRelationshipAsync:
                // - Xóa FriendWatch
                // - Xóa ConversationWatch
                // - Thông báo accessRevoked
                // - Không xóa dữ liệu SQL
                await presenceService
                    .RevokeRelationshipAsync(
                        actorUserId,
                        targetUserId,
                        cancellationToken);
            }
            catch (OperationCanceledException)
                when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                // Không để một lỗi Presence ngăn
                // các sự kiện Friendship tiếp theo.
                logger.LogWarning(
                    ex,
                    "Presence revoke failed after " +
                    "relationship change. " +
                    "Action={Action}, Actor={Actor}, " +
                    "Target={Target}",
                    action,
                    actorUserId,
                    targetUserId);
            }
        }

        // =================================================
        // 2. PUBLISH FRIENDSHIP TO ACTOR
        // =================================================

        var eventId = Guid.NewGuid();

        var occurredAtUtc = DateTime.UtcNow;

        await hubContext.Clients
            .User(actorUserId.ToString("D"))
            .SendAsync(
                "FriendshipChanged",
                new
                {
                    EventId = eventId,
                    Action = action,
                    ActorUserId = actorUserId,
                    TargetUserId = targetUserId,
                    OccurredAtUtc = occurredAtUtc
                },
                cancellationToken);

        // =================================================
        // 3. PUBLISH FRIENDSHIP TO TARGET
        // =================================================

        // Không tiết lộ trực tiếp rằng người kia
        // đã block/unblock mình.
        //
        // Frontend tự đọc trạng thái hiện tại
        // từ REST API, vốn áp dụng quyền của user.
        var targetAction =
            action is "blocked" or "unblocked"
                ? "changed"
                : action;

        await hubContext.Clients
            .User(targetUserId.ToString("D"))
            .SendAsync(
                "FriendshipChanged",
                new
                {
                    EventId = eventId,
                    Action = targetAction,
                    ActorUserId = actorUserId,
                    TargetUserId = targetUserId,
                    OccurredAtUtc = occurredAtUtc
                },
                cancellationToken);

        // =================================================
        // 4. REFRESH EXISTING PRIVATE CONVERSATION
        // =================================================

        try
        {
            var conversationId =
                await GetPrivateConversationIdForPairAsync(
                    actorUserId,
                    targetUserId,
                    cancellationToken);

            if (conversationId.HasValue)
            {
                await PublishConversationPermissionChangedAsync(
                    conversationId.Value,
                    cancellationToken);
            }
        }
        catch (OperationCanceledException)
            when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            // FriendshipChanged đã được phát.
            // Không phát lại event chỉ vì lỗi
            // khi yêu cầu cập nhật quyền hội thoại.
            logger.LogWarning(
                ex,
                "ConversationPermissionChanged failed " +
                "after FriendshipChanged. " +
                "Actor={Actor}, Target={Target}",
                actorUserId,
                targetUserId);
        }

        logger.LogInformation(
            "FriendshipChanged published. " +
            "Action={Action}, Actor={Actor}, Target={Target}",
            action,
            actorUserId,
            targetUserId);
    }

    // =====================================================
    // FIND EXISTING PRIVATE CONVERSATION
    // =====================================================

    private Task<Guid?> GetPrivateConversationIdForPairAsync(
        Guid firstUserId,
        Guid secondUserId,
        CancellationToken cancellationToken)
    {
        // Không tạo Conversation mới.
        // Không sửa dữ liệu hiện tại.

        return db.Conversations
            .AsNoTracking()
            .Where(c =>
                c.Type == PrivateConversationType &&
                (
                    (
                        c.PrivateUserLowId == firstUserId &&
                        c.PrivateUserHighId == secondUserId
                    )
                    ||
                    (
                        c.PrivateUserLowId == secondUserId &&
                        c.PrivateUserHighId == firstUserId
                    )
                ))
            .Select(c => (Guid?)c.Id)
            .FirstOrDefaultAsync(cancellationToken);
    }

    // =====================================================
    // VALIDATE USER PAIR
    // =====================================================

    private static void ValidateUserPair(
        Guid firstUserId,
        Guid secondUserId)
    {
        if (
            firstUserId == Guid.Empty ||
            secondUserId == Guid.Empty ||
            firstUserId == secondUserId
        )
        {
            throw new ArgumentException(
                "Cặp UserId không hợp lệ.");
        }
    }

    // =====================================================
    // GET EXACT PRIVATE CONVERSATION RECIPIENTS
    // =====================================================

    private async Task<List<Guid>?>
        GetPrivateRecipientsAsync(
            Guid conversationId,
            CancellationToken cancellationToken)
    {
        var conversation = await db.Conversations
            .AsNoTracking()
            .Where(c =>
                c.Id == conversationId &&
                c.Type == PrivateConversationType)
            .Select(c => new
            {
                c.PrivateUserLowId,
                c.PrivateUserHighId
            })
            .FirstOrDefaultAsync(cancellationToken);

        if (
            conversation is null ||
            !conversation.PrivateUserLowId.HasValue ||
            !conversation.PrivateUserHighId.HasValue
        )
        {
            return null;
        }

        var firstUserId =
            conversation.PrivateUserLowId.Value;

        var secondUserId =
            conversation.PrivateUserHighId.Value;

        if (
            firstUserId == Guid.Empty ||
            secondUserId == Guid.Empty ||
            firstUserId == secondUserId
        )
        {
            return null;
        }

        var memberIds =
            await db.ConversationMembers
                .AsNoTracking()
                .Where(m =>
                    m.ConversationId == conversationId)
                .Select(m => m.UserId)
                .ToListAsync(cancellationToken);

        if (
            memberIds.Count != 2 ||
            !memberIds.Contains(firstUserId) ||
            !memberIds.Contains(secondUserId)
        )
        {
            logger.LogWarning(
                "Invalid private conversation recipients. " +
                "ConversationId={ConversationId}",
                conversationId);

            return null;
        }

        return memberIds;
    }
}
