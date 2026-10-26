namespace WebChat.Api.DTOs.Friends;

public sealed class FriendUserListResponse
{
    public List<FriendUserResponse> Items { get; set; } = new();

    public int Page { get; set; }

    public int PageSize { get; set; }

    public int Total { get; set; }

    public int TotalPages { get; set; }

    public bool HasPreviousPage { get; set; }

    public bool HasNextPage { get; set; }
}