
using Microsoft.EntityFrameworkCore;
using WebChat.Api.Data;
using WebChat.Api.DTOs.Messages;

namespace WebChat.Api.Services.Messages;

public sealed class MessageReadService(AppDbContext db)
{
    private const byte PrivateConversationType = 1;

    public async Task<MarkAsReadResponse> MarkAsReadAsync(
        Guid conversationId,
        Guid currentUserId,
        long requestedSequence,
        CancellationToken cancellationToken = default)
    {
        // ============================================
        // 1. INPUT VALIDATION
        // ============================================

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
                "LastReadSequence phải lớn hơn 0.");
        }

        // ============================================
        // 2. CHECK CURRENT USER IS ACTIVE
        // ============================================

        var userIsActive = await db.Users
            .AsNoTracking()
            .AnyAsync(
                u => u.Id == currentUserId && u.IsActive,
                cancellationToken);

        if (!userIsActive)
        {
            throw new KeyNotFoundException(
                "Không tìm thấy hội thoại.");
        }

        // ============================================
        // 3. VERIFY PRIVATE CONVERSATION
        // ============================================

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

        if (!otherUserId.HasValue ||
            otherUserId.Value == Guid.Empty ||
            otherUserId.Value == currentUserId)
        {
            throw new InvalidOperationException(
                "Dữ liệu hội thoại không hợp lệ.");
        }

        // ============================================
        // 4. VERIFY EXACT PRIVATE MEMBERSHIP
        // ============================================

        var members = await db.ConversationMembers
            .AsNoTracking()
            .Where(m => m.ConversationId == conversationId)
            .Select(m => new
            {
                m.UserId,
                m.LeftAtUtc
            })
            .ToListAsync(cancellationToken);

        if (members.Count != 2 ||
            !members.Any(m =>
                m.UserId == currentUserId &&
                m.LeftAtUtc == null) ||
            !members.Any(m =>
                m.UserId == otherUserId.Value &&
                m.LeftAtUtc == null))
        {
            throw new KeyNotFoundException(
                "Không tìm thấy hội thoại.");
        }

        // ============================================
        // 5. VALIDATE REQUESTED SEQUENCE
        // ============================================

        if (requestedSequence >
            conversation.LastMessageSequence)
        {
            throw new MarkAsReadConflictException(
                "Sequence vượt quá tin nhắn cuối cùng.");
        }

        // Không chỉ dựa vào LastMessageSequence:
        // sequence được yêu cầu phải tồn tại thực tế.
        var targetMessageExists = await db.Messages
            .AsNoTracking()
            .AnyAsync(
                m =>
                    m.ConversationId == conversationId &&
                    m.SequenceNumber == requestedSequence,
                cancellationToken);

        if (!targetMessageExists)
        {
            throw new MarkAsReadConflictException(
                "Không tồn tại tin nhắn tại sequence này.");
        }

        // ============================================
        // 6. ATOMIC MONOTONIC UPDATE
        // ============================================

        // Không load entity rồi SaveChanges vì có
        // thể xảy ra lost update giữa nhiều thiết bị.
        //
        // SQL Server chỉ update khi cursor hiện tại
        // nhỏ hơn requestedSequence.
        //
        // Không cần thay đổi schema/rowversion.
        //
        // Mỗi request cập nhật tối đa một membership.

        var nowUtc = DateTime.UtcNow;

        var affectedRows = await db.ConversationMembers
            .Where(m =>
                m.ConversationId == conversationId &&
                m.UserId == currentUserId &&
                m.LeftAtUtc == null &&
                m.LastReadSequence < requestedSequence)
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(
                        m => m.LastReadSequence,
                        requestedSequence)
                    .SetProperty(
                        m => m.LastReadAtUtc,
                        (DateTime?)nowUtc),
                cancellationToken);

        if (affectedRows > 1)
        {
            // Unique index hiện có phải bảo đảm
            // tối đa một membership.
            throw new InvalidOperationException(
                "Dữ liệu membership không hợp lệ.");
        }

        // ============================================
        // 7. READ AUTHORITATIVE DATABASE STATE
        // ============================================

        // Một thiết bị khác có thể đã tăng cursor
        // lên giá trị cao hơn request hiện tại.
        //
        // Trả cursor mới nhất đọc được từ database,
        // không mặc định trả requestedSequence.

        var state = await db.ConversationMembers
            .AsNoTracking()
            .Where(m =>
                m.ConversationId == conversationId &&
                m.UserId == currentUserId &&
                m.LeftAtUtc == null)
            .Select(m => new
            {
                m.LastReadSequence,
                m.LastReadAtUtc
            })
            .FirstOrDefaultAsync(cancellationToken);

        if (state is null)
        {
            throw new KeyNotFoundException(
                "Không tìm thấy hội thoại.");
        }

        return new MarkAsReadResponse
        {
            ConversationId = conversationId,
            LastReadSequence = state.LastReadSequence,
            LastReadAtUtc = state.LastReadAtUtc,
            Changed = affectedRows == 1
        };
    }
}

public sealed class MarkAsReadConflictException(
    string message
) : Exception(message);
