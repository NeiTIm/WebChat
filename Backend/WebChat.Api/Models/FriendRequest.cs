namespace WebChat.Api.Models;

public sealed class FriendRequest
{
    public Guid Id { get; set; }

    public Guid SenderId { get; set; }

    public Guid ReceiverId { get; set; }

    public FriendRequestStatus Status { get; set; }
        = FriendRequestStatus.Pending;

    public DateTime CreatedAtUtc { get; set; }

    public DateTime? RespondedAtUtc { get; set; }

    public DateTime? CancelledAtUtc { get; set; }
}