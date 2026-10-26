
namespace WebChat.Api.DTOs.Conversations;

public sealed class ConversationDto
{
    // =====================================================
    // CONVERSATION
    // =====================================================

    public Guid Id { get; set; }

    public byte Type { get; set; }

    // =====================================================
    // OTHER USER
    // =====================================================

    public Guid OtherUserId { get; set; }

    public string OtherUsername { get; set; } =
        string.Empty;

    public string OtherDisplayName { get; set; } =
        string.Empty;

    public string? OtherAvatarUrl { get; set; }

    // =====================================================
    // CONVERSATION METADATA
    // =====================================================

    public DateTime CreatedAtUtc { get; set; }

    public DateTime? LastMessageAtUtc { get; set; }

    public long LastMessageSequence { get; set; }

    // =====================================================
    // NEW - LAST MESSAGE PREVIEW
    // =====================================================

    // Nội dung tin nhắn cuối.
    // Backend lấy từ bảng Messages.
    public string? LastMessageContent { get; set; }

    // Người gửi tin nhắn cuối.
    public Guid? LastMessageSenderId { get; set; }

    // =====================================================
    // EXISTING - READ CURSOR
    // =====================================================

    public long LastReadSequence { get; set; }

    // =====================================================
    // 5.8B - UNREAD COUNT
    // =====================================================

    public int UnreadCount { get; set; }

    // =====================================================
    // 5.8E1 - READ CURSORS
    // =====================================================

    public long MyLastReadSequence { get; set; }

    public long OtherLastReadSequence { get; set; }

    // =====================================================
    // 5.8E1 - DELIVERED CURSORS
    // =====================================================

    public long MyLastDeliveredSequence { get; set; }

    public long OtherLastDeliveredSequence { get; set; }

    // =====================================================
    // PERMISSIONS
    // =====================================================

    public bool CanSendMessage { get; set; }

    public string? CannotSendReason { get; set; }
}
