using WebChat.Api.DTOs.Friends;

namespace WebChat.Api.Services.Friends;

public interface IFriendRequestService
{
    Task<FriendRequestResponse> SendAsync(
        Guid senderId,
        Guid receiverId,
        CancellationToken ct = default);

    Task<FriendRequestListResponse> GetReceivedAsync(
        Guid userId,
        int page,
        int pageSize,
        CancellationToken ct = default);

    Task<FriendRequestListResponse> GetSentAsync(
        Guid userId,
        int page,
        int pageSize,
        CancellationToken ct = default);

    Task<FriendRequestResponse> AcceptAsync(
        Guid requestId,
        Guid currentUserId,
        CancellationToken ct = default);

    Task<FriendRequestResponse> RejectAsync(
        Guid requestId,
        Guid currentUserId,
        CancellationToken ct = default);

    Task<FriendRequestResponse> CancelAsync(
        Guid requestId,
        Guid currentUserId,
        CancellationToken ct = default);
}