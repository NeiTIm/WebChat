
using System.ComponentModel.DataAnnotations;

namespace WebChat.Api.DTOs.Messages;

public sealed class SendMessageRequest
{
    // Client tạo một GUID cho mỗi tin nhắn.
    // Khi retry phải sử dụng lại cùng GUID.
    [Required]
    public Guid ClientMessageId { get; set; }

    // Giai đoạn 5 chỉ hỗ trợ Text Message.
    [Required]
    [StringLength(4000, MinimumLength = 1)]
    public string Content { get; set; } = string.Empty;
}
