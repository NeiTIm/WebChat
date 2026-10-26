
using System.ComponentModel.DataAnnotations;

namespace WebChat.Api.DTOs.Conversations;

public sealed class OpenPrivateConversationRequest
{
    [Required]
    public Guid TargetUserId { get; set; }
}
