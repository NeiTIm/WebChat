namespace WebChat.Api.Models;

public enum FriendRequestStatus : byte
{
    Pending = 0,
    Accepted = 1,
    Rejected = 2,
    Cancelled = 3
}