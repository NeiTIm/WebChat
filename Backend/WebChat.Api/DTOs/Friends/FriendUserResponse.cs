namespace WebChat.Api.DTOs.Friends;

public sealed class FriendUserResponse
{
    public Guid UserId { get; set; }

    public string Username { get; set; } = string.Empty;

    public string DisplayName { get; set; } = string.Empty;

    public string? AvatarUrl { get; set; }

    public string? Bio { get; set; }

    // Ngày bắt đầu quan hệ bạn bè hoặc chặn.
    public DateTime SinceUtc { get; set; }
}