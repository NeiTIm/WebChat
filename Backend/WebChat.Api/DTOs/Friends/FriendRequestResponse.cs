namespace WebChat.Api.DTOs.Friends;

public sealed class FriendRequestResponse
{
    public Guid Id { get; set; }

    public Guid SenderId { get; set; }

    public Guid ReceiverId { get; set; }

    public string Status { get; set; } = string.Empty;

    public DateTime CreatedAtUtc { get; set; }

    public DateTime? RespondedAtUtc { get; set; }

    public DateTime? CancelledAtUtc { get; set; }

    public FriendRequestUserDto Sender { get; set; } = new();

    public FriendRequestUserDto Receiver { get; set; } = new();
}

public sealed class FriendRequestUserDto
{
    public Guid Id { get; set; }

    public string Username { get; set; } = string.Empty;

    public string DisplayName { get; set; } = string.Empty;

    public string? AvatarUrl { get; set; }
}