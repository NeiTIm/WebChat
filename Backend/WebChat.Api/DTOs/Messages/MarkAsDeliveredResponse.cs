
namespace WebChat.Api.DTOs.Messages;

public sealed class MarkAsDeliveredResponse
{
    public Guid ConversationId { get; set; }

    public long LastDeliveredSequence { get; set; }

    public DateTime? LastDeliveredAtUtc { get; set; }

    // true: request thực sự tăng Delivery Cursor.
    // false: cursor đã bằng hoặc lớn hơn giá trị yêu cầu.
    public bool Changed { get; set; }
}
