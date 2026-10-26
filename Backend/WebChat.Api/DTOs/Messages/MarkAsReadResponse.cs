
namespace WebChat.Api.DTOs.Messages;

public sealed class MarkAsReadResponse
{
    public Guid ConversationId { get; set; }

    public long LastReadSequence { get; set; }

    public DateTime? LastReadAtUtc { get; set; }

    // True khi request này thực sự cập nhật cursor.
    // False khi sequence đã được đọc trước đó.
    public bool Changed { get; set; }
}
