
using System.Data;
using Microsoft.EntityFrameworkCore;
using WebChat.Api.Data;
using WebChat.Api.DTOs.Messages;
using WebChat.Api.Models;
using WebChat.Api.Services.Friends;

namespace WebChat.Api.Services.Messages;

public sealed class MessageService(
    AppDbContext db
) : IMessageService
{
    private const byte PrivateConversationType = 1;
    private const byte TextMessageType = 1;
    private const int MaxContentLength = 4000;
    private const int MaxPageSize = 50;

    // =====================================================
    // SEND TEXT MESSAGE
    // =====================================================

    public async Task<MessageDto> SendTextAsync(
        Guid conversationId,
        Guid currentUserId,
        SendMessageRequest request,
        CancellationToken cancellationToken = default)
    {
        // =================================================
        // 1. VALIDATE
        // =================================================

        if (conversationId == Guid.Empty)
        {
            throw new ArgumentException(
                "ConversationId không hợp lệ.");
        }

        if (currentUserId == Guid.Empty)
        {
            throw new ArgumentException(
                "UserId không hợp lệ.");
        }

        if (request is null)
        {
            throw new ArgumentException(
                "Dữ liệu tin nhắn không hợp lệ.");
        }

        if (request.ClientMessageId == Guid.Empty)
        {
            throw new ArgumentException(
                "ClientMessageId không hợp lệ.");
        }

        var content = request.Content?.Trim();

        if (string.IsNullOrWhiteSpace(content))
        {
            throw new ArgumentException(
                "Nội dung tin nhắn không được để trống.");
        }

        if (content.Length > MaxContentLength)
        {
            throw new ArgumentException(
                "Tin nhắn không được vượt quá 4000 ký tự.");
        }

        // =================================================
        // 2. RESOLVE PRIVATE USER PAIR
        // =================================================

        // Chỉ đọc để xác định cặp User cần khóa.
        // Không dùng kết quả này để quyết định
        // quyền gửi tin hoặc cấp SequenceNumber.

        var pair = await db.Conversations
            .AsNoTracking()
            .Where(c =>
                c.Id == conversationId &&
                c.Type == PrivateConversationType &&
                (
                    c.PrivateUserLowId == currentUserId ||
                    c.PrivateUserHighId == currentUserId
                ))
            .Select(c => new
            {
                c.PrivateUserLowId,
                c.PrivateUserHighId
            })
            .FirstOrDefaultAsync(cancellationToken);

        if (pair is null)
        {
            throw new KeyNotFoundException(
                "Không tìm thấy hội thoại.");
        }

        Guid otherUserId;

        if (pair.PrivateUserLowId == currentUserId)
        {
            otherUserId =
                pair.PrivateUserHighId ?? Guid.Empty;
        }
        else
        {
            otherUserId =
                pair.PrivateUserLowId ?? Guid.Empty;
        }

        if (otherUserId == Guid.Empty ||
            otherUserId == currentUserId)
        {
            throw new InvalidOperationException(
                "Dữ liệu hội thoại không hợp lệ.");
        }

        // =================================================
        // 3. BEGIN TRANSACTION
        // =================================================

        // Dùng ReadCommitted và application locks
        // thống nhất với các thao tác Friends.
        //
        // Không đọc Friendship/Block để quyết định
        // quyền gửi trước khi lấy FriendPairLock.

        await using var transaction =
            await db.Database.BeginTransactionAsync(
                IsolationLevel.ReadCommitted,
                cancellationToken);

        // =================================================
        // 4. ACQUIRE FRIEND PAIR LOCK
        // =================================================

        // Phối hợp trực tiếp với:
        // - RemoveFriendAsync
        // - BlockUserAsync
        // - UnblockUserAsync
        //
        // Thứ tự khóa cố định:
        // FriendPairLock -> MessageLock.

        await FriendPairLock.AcquireAsync(
            db,
            currentUserId,
            otherUserId,
            cancellationToken);

        // =================================================
        // 5. ACQUIRE CONVERSATION MESSAGE LOCK
        // =================================================

        var lockResource =
            $"WebChat:Message:{conversationId:N}";

        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
            DECLARE @lockResult int;

            EXEC @lockResult = sys.sp_getapplock
                @Resource = {lockResource},
                @LockMode = 'Exclusive',
                @LockOwner = 'Transaction',
                @LockTimeout = 10000;

            IF @lockResult < 0
                THROW 51001,
                    'Cannot acquire message write lock.',
                    1;
            """,
            cancellationToken);

        // =================================================
        // 6. VERIFY ACTIVE USERS AFTER LOCK
        // =================================================

        var activeUsers = await db.Users
            .AsNoTracking()
            .CountAsync(
                x =>
                    (x.Id == currentUserId ||
                     x.Id == otherUserId) &&
                    x.IsActive,
                cancellationToken);

        if (activeUsers != 2)
        {
            throw new InvalidOperationException(
                "Một trong hai tài khoản không khả dụng.");
        }

        // =================================================
        // 7. RELOAD CONVERSATION AFTER LOCK
        // =================================================

        // Entity tracking để cập nhật metadata.
        // Đọc lại bên trong transaction, sau khi khóa.

        var conversation = await db.Conversations
            .FirstOrDefaultAsync(
                c =>
                    c.Id == conversationId &&
                    c.Type == PrivateConversationType,
                cancellationToken);

        if (conversation is null)
        {
            throw new KeyNotFoundException(
                "Không tìm thấy hội thoại.");
        }

        var validPair =
            (
                conversation.PrivateUserLowId ==
                    currentUserId &&
                conversation.PrivateUserHighId ==
                    otherUserId
            )
            ||
            (
                conversation.PrivateUserHighId ==
                    currentUserId &&
                conversation.PrivateUserLowId ==
                    otherUserId
            );

        if (!validPair)
        {
            throw new InvalidOperationException(
                "Dữ liệu cặp thành viên hội thoại " +
                "đã thay đổi hoặc không hợp lệ.");
        }

        // =================================================
        // 8. VERIFY MEMBERSHIP
        // =================================================

        var memberIds = await db.ConversationMembers
            .AsNoTracking()
            .Where(x =>
                x.ConversationId == conversationId)
            .Select(x => x.UserId)
            .ToListAsync(cancellationToken);

        if (memberIds.Count != 2 ||
            !memberIds.Contains(currentUserId) ||
            !memberIds.Contains(otherUserId))
        {
            throw new InvalidOperationException(
                "Thành viên hội thoại không hợp lệ.");
        }

        // =================================================
        // 9. IDEMPOTENCY
        // =================================================

        // Truy vấn sau các khóa để retry đồng thời
        // không cùng vượt qua bước kiểm tra này.

        var existingMessage = await db.Messages
            .AsNoTracking()
            .FirstOrDefaultAsync(
                x =>
                    x.SenderId == currentUserId &&
                    x.ClientMessageId ==
                        request.ClientMessageId,
                cancellationToken);

        if (existingMessage is not null)
        {
            if (existingMessage.ConversationId !=
                conversationId)
            {
                throw new InvalidOperationException(
                    "ClientMessageId đã được sử dụng " +
                    "cho hội thoại khác.");
            }

            if (existingMessage.Content != content ||
                existingMessage.Type != TextMessageType)
            {
                throw new InvalidOperationException(
                    "ClientMessageId đã được sử dụng " +
                    "cho nội dung khác.");
            }

            // Retry một tin đã được lưu trước đó.
            // Không tạo mới, không tăng Sequence.
            //
            // Đây không phải quyền gửi tin mới.

            await transaction.CommitAsync(
                cancellationToken);

            return MapMessage(existingMessage);
        }

        // =================================================
        // 10. CHECK FRIENDSHIP AFTER FRIEND PAIR LOCK
        // =================================================

        var areFriends = await db.Friendships
            .AsNoTracking()
            .AnyAsync(
                x =>
                    (
                        x.UserAId == currentUserId &&
                        x.UserBId == otherUserId
                    )
                    ||
                    (
                        x.UserAId == otherUserId &&
                        x.UserBId == currentUserId
                    ),
                cancellationToken);

        if (!areFriends)
        {
            throw new UnauthorizedAccessException(
                "Hai người hiện không còn là bạn bè.");
        }

        // =================================================
        // 11. CHECK BLOCK AFTER FRIEND PAIR LOCK
        // =================================================

        var isBlocked = await db.UserBlocks
            .AsNoTracking()
            .AnyAsync(
                x =>
                    (
                        x.BlockerId == currentUserId &&
                        x.BlockedId == otherUserId
                    )
                    ||
                    (
                        x.BlockerId == otherUserId &&
                        x.BlockedId == currentUserId
                    ),
                cancellationToken);

        if (isBlocked)
        {
            throw new UnauthorizedAccessException(
                "Không thể gửi tin nhắn vì có " +
                "quan hệ chặn giữa hai người.");
        }

        // =================================================
        // 12. GENERATE SEQUENCE NUMBER
        // =================================================

        if (conversation.LastMessageSequence ==
            long.MaxValue)
        {
            throw new InvalidOperationException(
                "Hội thoại đã đạt giới hạn SequenceNumber.");
        }

        var nextSequence =
            conversation.LastMessageSequence + 1;

        var now = DateTime.UtcNow;

        // =================================================
        // 13. CREATE MESSAGE
        // =================================================

        var message = new Message
        {
            Id = Guid.NewGuid(),
            ConversationId = conversation.Id,
            SenderId = currentUserId,
            ClientMessageId = request.ClientMessageId,
            SequenceNumber = nextSequence,
            Type = TextMessageType,
            Content = content,
            CreatedAtUtc = now,
            EditedAtUtc = null,
            RecalledAtUtc = null,
            ReplyToMessageId = null
        };

        db.Messages.Add(message);

        // =================================================
        // 14. UPDATE CONVERSATION
        // =================================================

        conversation.LastMessageSequence =
            nextSequence;

        conversation.LastMessageAtUtc = now;
        conversation.UpdatedAtUtc = now;

        // =================================================
        // 15. ATOMIC SAVE + COMMIT
        // =================================================

        await db.SaveChangesAsync(
            cancellationToken);

        await transaction.CommitAsync(
            cancellationToken);

        return MapMessage(message);
    }

    // =====================================================
    // MESSAGE HISTORY - CURSOR PAGINATION
    // =====================================================

    public async Task<MessageListResponse> GetMessagesAsync(
        Guid conversationId,
        Guid currentUserId,
        long? beforeSequence,
        int pageSize,
        CancellationToken cancellationToken = default)
    {
        if (conversationId == Guid.Empty ||
            currentUserId == Guid.Empty)
        {
            throw new KeyNotFoundException(
                "Không tìm thấy hội thoại.");
        }

        if (beforeSequence.HasValue &&
            beforeSequence.Value <= 0)
        {
            throw new ArgumentException(
                "beforeSequence phải lớn hơn 0.");
        }

        if (pageSize < 1 || pageSize > MaxPageSize)
        {
            throw new ArgumentException(
                "pageSize phải từ 1 đến 50.");
        }

        var currentUserActive = await db.Users
            .AsNoTracking()
            .AnyAsync(
                x =>
                    x.Id == currentUserId &&
                    x.IsActive,
                cancellationToken);

        if (!currentUserActive)
        {
            throw new KeyNotFoundException(
                "Không tìm thấy hội thoại.");
        }

        // =================================================
        // VERIFY PRIVATE CONVERSATION MEMBERSHIP
        // =================================================

        var conversation = await db.Conversations
            .AsNoTracking()
            .Where(c =>
                c.Id == conversationId &&
                c.Type == PrivateConversationType &&
                (
                    c.PrivateUserLowId == currentUserId ||
                    c.PrivateUserHighId == currentUserId
                ) &&
                db.ConversationMembers.Any(m =>
                    m.ConversationId == c.Id &&
                    m.UserId == currentUserId))
            .Select(c => new
            {
                c.Id,
                c.PrivateUserLowId,
                c.PrivateUserHighId
            })
            .FirstOrDefaultAsync(cancellationToken);

        if (conversation is null)
        {
            throw new KeyNotFoundException(
                "Không tìm thấy hội thoại.");
        }

        var otherUserId =
            conversation.PrivateUserLowId == currentUserId
                ? conversation.PrivateUserHighId
                : conversation.PrivateUserLowId;

        if (!otherUserId.HasValue)
        {
            throw new InvalidOperationException(
                "Dữ liệu hội thoại không hợp lệ.");
        }

        var members = await db.ConversationMembers
            .AsNoTracking()
            .Where(m =>
                m.ConversationId == conversationId)
            .Select(m => m.UserId)
            .ToListAsync(cancellationToken);

        if (members.Count != 2 ||
            !members.Contains(currentUserId) ||
            !members.Contains(otherUserId.Value))
        {
            throw new InvalidOperationException(
                "Thành viên hội thoại không hợp lệ.");
        }

        // Không kiểm tra Friendship/Block khi đọc.
        // Lịch sử vẫn tồn tại sau Unfriend/Block.

        // =================================================
        // QUERY MESSAGES
        // =================================================

        var query = db.Messages
            .AsNoTracking()
            .Where(m =>
                m.ConversationId == conversationId);

        if (beforeSequence.HasValue)
        {
            var cursor = beforeSequence.Value;

            query = query.Where(
                m => m.SequenceNumber < cursor);
        }

        var messages = await query
            .OrderByDescending(m => m.SequenceNumber)
            .Take(pageSize + 1)
            .Select(m => new MessageDto
            {
                Id = m.Id,
                ConversationId = m.ConversationId,
                SenderId = m.SenderId,
                ClientMessageId = m.ClientMessageId,
                SequenceNumber = m.SequenceNumber,
                Type = m.Type,
                Content = m.Content,
                CreatedAtUtc = m.CreatedAtUtc,
                EditedAtUtc = m.EditedAtUtc,
                RecalledAtUtc = m.RecalledAtUtc,
                ReplyToMessageId = m.ReplyToMessageId
            })
            .ToListAsync(cancellationToken);

        // =================================================
        // PAGINATION METADATA
        // =================================================

        var hasMore = messages.Count > pageSize;

        if (hasMore)
        {
            messages.RemoveAt(messages.Count - 1);
        }

        messages.Reverse();

        long? nextBeforeSequence =
            hasMore && messages.Count > 0
                ? messages[0].SequenceNumber
                : null;

        return new MessageListResponse
        {
            ConversationId = conversationId,
            Items = messages,
            PageSize = pageSize,
            NextBeforeSequence = nextBeforeSequence,
            HasMore = hasMore
        };
    }

    // =====================================================
    // MAPPING
    // =====================================================

    private static MessageDto MapMessage(Message message)
    {
        return new MessageDto
        {
            Id = message.Id,
            ConversationId = message.ConversationId,
            SenderId = message.SenderId,
            ClientMessageId = message.ClientMessageId,
            SequenceNumber = message.SequenceNumber,
            Type = message.Type,
            Content = message.Content,
            CreatedAtUtc = message.CreatedAtUtc,
            EditedAtUtc = message.EditedAtUtc,
            RecalledAtUtc = message.RecalledAtUtc,
            ReplyToMessageId = message.ReplyToMessageId
        };
    }
}
