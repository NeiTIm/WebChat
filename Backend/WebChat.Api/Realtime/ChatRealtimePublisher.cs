
using System.Data;

using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

using WebChat.Api.Data;
using WebChat.Api.DTOs.Messages;
using WebChat.Api.Hubs;
using WebChat.Api.Services.Friends;

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

        await hubContext.Clients
            .Users(userIds)
            .SendAsync(
                "MessageCreated",
                message,
                cancellationToken);

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

        // Thu hồi Presence sau Unfriend/Block.
        if (
            action == "removed" ||
            action == "blocked"
        )
        {
            try
            {
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

        var eventId = Guid.NewGuid();
        var occurredAtUtc = DateTime.UtcNow;

        // Phát FriendshipChanged cho Actor.
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

        // Không tiết lộ trực tiếp Block/Unblock
        // cho người đối diện.
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

        // Refresh quyền của conversation hiện có.
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
    // 5.8C - MESSAGE READ UPDATED
    // =====================================================

    public async Task PublishMessageReadUpdatedAsync(
        MarkAsReadResponse result,
        Guid readerUserId,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(result);

        if (
            !result.Changed ||
            result.ConversationId == Guid.Empty ||
            readerUserId == Guid.Empty ||
            result.LastReadSequence <= 0
        )
        {
            return;
        }

        var recipients = await GetPrivateRecipientsAsync(
            result.ConversationId,
            cancellationToken);

        if (
            recipients is null ||
            !recipients.Contains(readerUserId)
        )
        {
            logger.LogWarning(
                "Skip MessageReadUpdated: invalid membership. " +
                "ConversationId={ConversationId}, Reader={ReaderUserId}",
                result.ConversationId,
                readerUserId);

            return;
        }

        var otherUserId = recipients.Single(
            id => id != readerUserId);

        var readerActive = await db.Users
            .AsNoTracking()
            .AnyAsync(
                x =>
                    x.Id == readerUserId &&
                    x.IsActive,
                cancellationToken);

        if (!readerActive)
        {
            return;
        }

        var readState = await db.ConversationMembers
            .AsNoTracking()
            .Where(x =>
                x.ConversationId == result.ConversationId &&
                x.UserId == readerUserId &&
                x.LeftAtUtc == null)
            .Select(x => new
            {
                x.LastReadSequence,
                x.LastReadAtUtc
            })
            .FirstOrDefaultAsync(cancellationToken);

        if (
            readState is null ||
            readState.LastReadSequence <= 0 ||
            readState.LastReadAtUtc is null
        )
        {
            return;
        }

        var payload = new
        {
            ConversationId = result.ConversationId,
            ReaderUserId = readerUserId,
            LastReadSequence = readState.LastReadSequence,
            LastReadAtUtc = readState.LastReadAtUtc
        };

        // Các thiết bị của chính người đọc.
        await hubContext.Clients
            .User(readerUserId.ToString("D"))
            .SendAsync(
                "MessageReadUpdated",
                payload,
                cancellationToken);

        // Revalidate Friendship/Block dưới FriendPairLock.
        await using var transaction =
            await db.Database.BeginTransactionAsync(
                IsolationLevel.ReadCommitted,
                cancellationToken);

        await FriendPairLock.AcquireAsync(
            db,
            readerUserId,
            otherUserId,
            cancellationToken);

        var validRecipients = await GetPrivateRecipientsAsync(
            result.ConversationId,
            cancellationToken);

        if (
            validRecipients is null ||
            !validRecipients.Contains(readerUserId) ||
            !validRecipients.Contains(otherUserId)
        )
        {
            return;
        }

        var activeUsers = await db.Users
            .AsNoTracking()
            .CountAsync(
                x =>
                    (x.Id == readerUserId ||
                     x.Id == otherUserId) &&
                    x.IsActive,
                cancellationToken);

        if (activeUsers != 2)
        {
            return;
        }

        var areFriends = await db.Friendships
            .AsNoTracking()
            .AnyAsync(
                x =>
                    (x.UserAId == readerUserId &&
                     x.UserBId == otherUserId) ||
                    (x.UserAId == otherUserId &&
                     x.UserBId == readerUserId),
                cancellationToken);

        if (!areFriends)
        {
            return;
        }

        var isBlocked = await db.UserBlocks
            .AsNoTracking()
            .AnyAsync(
                x =>
                    (x.BlockerId == readerUserId &&
                     x.BlockedId == otherUserId) ||
                    (x.BlockerId == otherUserId &&
                     x.BlockedId == readerUserId),
                cancellationToken);

        if (isBlocked)
        {
            return;
        }

        await hubContext.Clients
            .User(otherUserId.ToString("D"))
            .SendAsync(
                "MessageReadUpdated",
                payload,
                cancellationToken);

        await transaction.CommitAsync(cancellationToken);

        logger.LogDebug(
            "MessageReadUpdated published. " +
            "ConversationId={ConversationId}, " +
            "Reader={ReaderUserId}, Sequence={Sequence}",
            result.ConversationId,
            readerUserId,
            readState.LastReadSequence);
    }

    // =====================================================
    // 5.8D3 - MESSAGE DELIVERED UPDATED
    // =====================================================

    public async Task PublishMessageDeliveredUpdatedAsync(
        MarkAsDeliveredResponse result,
        Guid recipientUserId,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(result);

        // Không phát nếu REST ACK không tăng cursor.
        if (
            !result.Changed ||
            result.ConversationId == Guid.Empty ||
            recipientUserId == Guid.Empty ||
            result.LastDeliveredSequence <= 0
        )
        {
            return;
        }

        // =================================================
        // 1. VERIFY EXACT PRIVATE RECIPIENTS
        // =================================================

        var recipients = await GetPrivateRecipientsAsync(
            result.ConversationId,
            cancellationToken);

        if (
            recipients is null ||
            !recipients.Contains(recipientUserId)
        )
        {
            logger.LogWarning(
                "Skip MessageDeliveredUpdated: " +
                "invalid membership. " +
                "ConversationId={ConversationId}, " +
                "RecipientUserId={RecipientUserId}",
                result.ConversationId,
                recipientUserId);

            return;
        }

        var otherUserId = recipients.Single(
            id => id != recipientUserId);

        // =================================================
        // 2. CHECK RECIPIENT IS ACTIVE
        // =================================================

        var recipientActive = await db.Users
            .AsNoTracking()
            .AnyAsync(
                x =>
                    x.Id == recipientUserId &&
                    x.IsActive,
                cancellationToken);

        if (!recipientActive)
        {
            return;
        }

        // =================================================
        // 3. LOAD AUTHORITATIVE DELIVERY CURSOR
        // =================================================

        var deliveryState = await db.ConversationMembers
            .AsNoTracking()
            .Where(x =>
                x.ConversationId == result.ConversationId &&
                x.UserId == recipientUserId &&
                x.LeftAtUtc == null)
            .Select(x => new
            {
                x.LastDeliveredSequence,
                x.LastDeliveredAtUtc
            })
            .FirstOrDefaultAsync(cancellationToken);

        if (
            deliveryState is null ||
            deliveryState.LastDeliveredSequence <= 0 ||
            deliveryState.LastDeliveredAtUtc is null
        )
        {
            return;
        }

        // Một thiết bị khác có thể đã ACK lên sequence
        // cao hơn trong lúc publisher chuẩn bị event.
        // Vì vậy đọc cursor mới nhất từ SQL Server.
        var payload = new
        {
            ConversationId = result.ConversationId,
            RecipientUserId = recipientUserId,
            LastDeliveredSequence =
                deliveryState.LastDeliveredSequence,
            LastDeliveredAtUtc =
                deliveryState.LastDeliveredAtUtc
        };

        // =================================================
        // 4. SYNC RECIPIENT'S OWN DEVICES
        // =================================================

        // Phát cho tài khoản tự ACK ngay cả sau
        // Unfriend/Block để đồng bộ cursor lịch sử.
        await hubContext.Clients
            .User(recipientUserId.ToString("D"))
            .SendAsync(
                "MessageDeliveredUpdated",
                payload,
                cancellationToken);

        // =================================================
        // 5. COORDINATE RELATIONSHIP WITH PAIR LOCK
        // =================================================

        // Transaction này KHÔNG ghi Delivery Cursor.
        // FriendPairLock phối hợp với Block/Unfriend
        // để tránh TOCTOU khi kiểm tra quan hệ.
        await using var transaction =
            await db.Database.BeginTransactionAsync(
                IsolationLevel.ReadCommitted,
                cancellationToken);

        await FriendPairLock.AcquireAsync(
            db,
            recipientUserId,
            otherUserId,
            cancellationToken);

        // =================================================
        // 6. REVALIDATE MEMBERSHIP
        // =================================================

        var validRecipients = await GetPrivateRecipientsAsync(
            result.ConversationId,
            cancellationToken);

        if (
            validRecipients is null ||
            !validRecipients.Contains(recipientUserId) ||
            !validRecipients.Contains(otherUserId)
        )
        {
            return;
        }

        // =================================================
        // 7. REVALIDATE ACTIVE ACCOUNTS
        // =================================================

        var activeUserCount = await db.Users
            .AsNoTracking()
            .CountAsync(
                x =>
                    (x.Id == recipientUserId ||
                     x.Id == otherUserId) &&
                    x.IsActive,
                cancellationToken);

        if (activeUserCount != 2)
        {
            return;
        }

        // =================================================
        // 8. REVALIDATE FRIENDSHIP
        // =================================================

        var areFriends = await db.Friendships
            .AsNoTracking()
            .AnyAsync(
                x =>
                    (x.UserAId == recipientUserId &&
                     x.UserBId == otherUserId) ||
                    (x.UserAId == otherUserId &&
                     x.UserBId == recipientUserId),
                cancellationToken);

        if (!areFriends)
        {
            return;
        }

        // =================================================
        // 9. REVALIDATE BLOCK IN BOTH DIRECTIONS
        // =================================================

        var isBlocked = await db.UserBlocks
            .AsNoTracking()
            .AnyAsync(
                x =>
                    (x.BlockerId == recipientUserId &&
                     x.BlockedId == otherUserId) ||
                    (x.BlockerId == otherUserId &&
                     x.BlockedId == recipientUserId),
                cancellationToken);

        if (isBlocked)
        {
            return;
        }

        // =================================================
        // 10. PUBLISH TO THE OTHER USER
        // =================================================

        await hubContext.Clients
            .User(otherUserId.ToString("D"))
            .SendAsync(
                "MessageDeliveredUpdated",
                payload,
                cancellationToken);

        await transaction.CommitAsync(cancellationToken);

        logger.LogDebug(
            "MessageDeliveredUpdated published. " +
            "ConversationId={ConversationId}, " +
            "Recipient={RecipientUserId}, " +
            "Sequence={Sequence}",
            result.ConversationId,
            recipientUserId,
            deliveryState.LastDeliveredSequence);
    }

    // =====================================================
    // FIND EXISTING PRIVATE CONVERSATION
    // =====================================================

    private Task<Guid?> GetPrivateConversationIdForPairAsync(
        Guid firstUserId,
        Guid secondUserId,
        CancellationToken cancellationToken)
    {
        return db.Conversations
            .AsNoTracking()
            .Where(c =>
                c.Type == PrivateConversationType &&
                (
                    (
                        c.PrivateUserLowId == firstUserId &&
                        c.PrivateUserHighId == secondUserId
                    ) ||
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

        var memberIds = await db.ConversationMembers
            .AsNoTracking()
            .Where(m => m.ConversationId == conversationId)
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
