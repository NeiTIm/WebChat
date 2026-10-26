
namespace WebChat.Api.DTOs.Conversations;

public sealed class ConversationDto
{
    public Guid Id { get; set; }

    public byte Type { get; set; }

    public Guid OtherUserId { get; set; }

    public string OtherUsername { get; set; } = string.Empty;

    public string OtherDisplayName { get; set; } = string.Empty;

    public string? OtherAvatarUrl { get; set; }

    public DateTime CreatedAtUtc { get; set; }

    public DateTime? LastMessageAtUtc { get; set; }

    public long LastMessageSequence { get; set; }

    public long LastReadSequence { get; set; }

    // PHASE 5.8B
    // Số tin nhắn từ người khác nằm sau Read Cursor.
    // Chỉ là giá trị tính toán, không lưu vào database.
    public int UnreadCount { get; set; }

    // Quyền gửi tin, được tính từ Friendship,
    // Block và trạng thái tài khoản hiện tại.
    public bool CanSendMessage { get; set; }

    public string? CannotSendReason { get; set; }
}
