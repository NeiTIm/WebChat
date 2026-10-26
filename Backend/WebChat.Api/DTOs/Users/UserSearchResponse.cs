namespace WebChat.Api.DTOs.Users;

public sealed class UserSearchResponse
{
    public List<UserSearchItemResponse> Items { get; set; } = new();

    public int Page { get; set; }

    public int PageSize { get; set; }

    public int Total { get; set; }

    public int TotalPages { get; set; }

    public bool HasPreviousPage { get; set; }

    public bool HasNextPage { get; set; }
}