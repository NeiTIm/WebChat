using System;

namespace WebChat.Api.Models;

public sealed class Message
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid ConversationId { get; set; }

    public Guid SenderId { get; set; }

    // Định danh do Frontend tạo để chống gửi trùng.
    public Guid ClientMessageId { get; set; }

    // Tăng tuần tự trong một Conversation.
    public long SequenceNumber { get; set; }

    // 1 = Text. Loại khác bổ sung về sau.
    public byte Type { get; set; } = 1;

    // Nullable để có thể mở rộng loại tin nhắn khác.
    // Với Type = Text, DB bắt buộc Content hợp lệ.
    public string? Content { get; set; }

    public DateTime CreatedAtUtc { get; set; } =
        DateTime.UtcNow;

    public DateTime? EditedAtUtc { get; set; }

    public DateTime? RecalledAtUtc { get; set; }

    // Dự phòng Reply Message.
    public Guid? ReplyToMessageId { get; set; }

    // Navigation
    public Conversation Conversation { get; set; } = null!;
}