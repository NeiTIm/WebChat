
namespace WebChat.Api.DTOs.Messages;

public sealed class MessageListResponse
{
    public Guid ConversationId { get; set; }

    public List<MessageDto> Items { get; set; } = [];

    public int PageSize { get; set; }

    // Cursor để tải trang tin nhắn cũ hơn.
    public long? NextBeforeSequence { get; set; }

    public bool HasMore { get; set; }
}
