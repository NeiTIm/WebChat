namespace WebChat.Api.DTOs.Friends;

public sealed class FriendStatusesRequest
{
    public List<Guid> UserIds { get; set; } = new();
}

public sealed class FriendStatusItemResponse
{
    public Guid UserId { get; set; }

    // None, Friend, PendingSent, PendingReceived,
    // Blocked, Unavailable
    public string Status { get; set; } = "None";

    public Guid? RequestId { get; set; }
}

public sealed class FriendStatusesResponse
{
    public List<FriendStatusItemResponse> Items { get; set; } = new();
}