
namespace WebChat.Api.DTOs.Messages;

public sealed class MessageDto
{
    public Guid Id { get; set; }

    public Guid ConversationId { get; set; }

    public Guid SenderId { get; set; }

    public Guid ClientMessageId { get; set; }

    public long SequenceNumber { get; set; }

    // 1 = Text
    public byte Type { get; set; }

    public string? Content { get; set; }

    public DateTime CreatedAtUtc { get; set; }

    public DateTime? EditedAtUtc { get; set; }

    public DateTime? RecalledAtUtc { get; set; }

    public Guid? ReplyToMessageId { get; set; }
}
