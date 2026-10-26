
using Microsoft.EntityFrameworkCore;

using WebChat.Api.Data;
using WebChat.Api.DTOs.Messages;

namespace WebChat.Api.Services.Messages;

public sealed class MessageDeliveryService(AppDbContext db)
{
    private const byte PrivateConversationType = 1;

    public async Task<MarkAsDeliveredResponse>
        MarkAsDeliveredAsync(
            Guid conversationId,
            Guid currentUserId,
            long requestedSequence,
            CancellationToken cancellationToken = default)
    {
        // =====================================================
        // 1. VALIDATE REQUEST
        // =====================================================

        if (conversationId == Guid.Empty)
        {
            throw new ArgumentException(
                "ConversationId không hợp lệ.");
        }

        if (currentUserId == Guid.Empty)
        {
            throw new KeyNotFoundException(
                "Không tìm thấy hội thoại.");
        }

        if (requestedSequence <= 0)
        {
            throw new ArgumentException(
                "LastDeliveredSequence phải lớn hơn 0.");
        }

        // =====================================================
        // 2. VALIDATE ACTIVE USER
        // =====================================================

        var userIsActive = await db.Users
            .AsNoTracking()
            .AnyAsync(
                u =>
                    u.Id == currentUserId &&
                    u.IsActive,
                cancellationToken);

        if (!userIsActive)
        {
            throw new KeyNotFoundException(
                "Không tìm thấy hội thoại.");
        }

        // =====================================================
        // 3. VALIDATE PRIVATE CONVERSATION
        // =====================================================

        var conversation = await db.Conversations
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
                c.Id,
                c.PrivateUserLowId,
                c.PrivateUserHighId,
                c.LastMessageSequence
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

        if (
            !otherUserId.HasValue ||
            otherUserId.Value == Guid.Empty ||
            otherUserId.Value == currentUserId
        )
        {
            throw new InvalidOperationException(
                "Dữ liệu hội thoại không hợp lệ.");
        }

        // =====================================================
        // 4. VALIDATE EXACT MEMBERSHIP
        // =====================================================

        var members = await db.ConversationMembers
            .AsNoTracking()
            .Where(m =>
                m.ConversationId == conversationId)
            .Select(m => new
            {
                m.UserId,
                m.LeftAtUtc
            })
            .ToListAsync(cancellationToken);

        if (
            members.Count != 2 ||
            !members.Any(m =>
                m.UserId == currentUserId &&
                m.LeftAtUtc == null) ||
            !members.Any(m =>
                m.UserId == otherUserId.Value &&
                m.LeftAtUtc == null)
        )
        {
            throw new KeyNotFoundException(
                "Không tìm thấy hội thoại.");
        }

        // =====================================================
        // 5. VALIDATE TARGET SEQUENCE
        // =====================================================

        if (requestedSequence >
            conversation.LastMessageSequence)
        {
            throw new MarkAsDeliveredConflictException(
                "Sequence vượt quá tin nhắn cuối cùng.");
        }

        var targetMessageExists = await db.Messages
            .AsNoTracking()
            .AnyAsync(
                m =>
                    m.ConversationId == conversationId &&
                    m.SequenceNumber == requestedSequence,
                cancellationToken);

        if (!targetMessageExists)
        {
            throw new MarkAsDeliveredConflictException(
                "Không tồn tại tin nhắn tại sequence này.");
        }

        // =====================================================
        // 6. ATOMIC MONOTONIC UPDATE
        // =====================================================

        // Client có trách nhiệm bảo đảm đã đồng bộ
        // đầy đủ khoảng sequence trước khi ACK.
        //
        // Backend xác thực user, membership và
        // target sequence, sau đó chỉ cập nhật nếu
        // requestedSequence lớn hơn cursor hiện tại.
        //
        // Không cần FriendPairLock khi ghi vào
        // membership của chính người dùng.

        var nowUtc = DateTime.UtcNow;

        var affectedRows = await db.ConversationMembers
            .Where(m =>
                m.ConversationId == conversationId &&
                m.UserId == currentUserId &&
                m.LeftAtUtc == null &&
                m.LastDeliveredSequence <
                    requestedSequence)
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(
                        m => m.LastDeliveredSequence,
                        requestedSequence)
                    .SetProperty(
                        m => m.LastDeliveredAtUtc,
                        (DateTime?)nowUtc),
                cancellationToken);

        if (affectedRows > 1)
        {
            throw new InvalidOperationException(
                "Dữ liệu membership không hợp lệ.");
        }

        // =====================================================
        // 7. FETCH AUTHORITATIVE DATABASE STATE
        // =====================================================

        // Trạng thái thực tế có thể lớn hơn
        // requestedSequence do một thiết bị khác
        // vừa cập nhật cursor.
        //
        // changed chỉ phản ánh request hiện tại
        // có thực hiện UPDATE thành công hay không.

        var state = await db.ConversationMembers
            .AsNoTracking()
            .Where(m =>
                m.ConversationId == conversationId &&
                m.UserId == currentUserId &&
                m.LeftAtUtc == null)
            .Select(m => new
            {
                m.LastDeliveredSequence,
                m.LastDeliveredAtUtc
            })
            .FirstOrDefaultAsync(cancellationToken);

        if (state is null)
        {
            throw new KeyNotFoundException(
                "Không tìm thấy hội thoại.");
        }

        return new MarkAsDeliveredResponse
        {
            ConversationId = conversationId,
            LastDeliveredSequence =
                state.LastDeliveredSequence,
            LastDeliveredAtUtc =
                state.LastDeliveredAtUtc,
            Changed = affectedRows == 1
        };
    }
}

public sealed class MarkAsDeliveredConflictException(
    string message
) : Exception(message);
