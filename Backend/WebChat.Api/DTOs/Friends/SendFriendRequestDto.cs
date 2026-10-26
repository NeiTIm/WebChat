using System.ComponentModel.DataAnnotations;

namespace WebChat.Api.DTOs.Friends;

public sealed class SendFriendRequestDto
{
    [Required]
    public Guid ReceiverId { get; set; }
}