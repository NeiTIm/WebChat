namespace WebChat.Api.Services.Friends;

public sealed class FriendRequestException : Exception
{
    public int StatusCode { get; }

    public FriendRequestException(
        string message,
        int statusCode = 400)
        : base(message)
    {
        StatusCode = statusCode;
    }
}