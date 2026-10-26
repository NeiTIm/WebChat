using WebChat.Api.DTOs.Friends;

namespace WebChat.Api.Services.Friends;

public interface IFriendRelationshipService
{
    Task<FriendUserListResponse> GetFriendsAsync(
        Guid currentUserId,
        int page,
        int pageSize,
        CancellationToken ct = default);

    Task RemoveFriendAsync(
        Guid currentUserId,
        Guid friendUserId,
        CancellationToken ct = default);

    Task BlockUserAsync(
        Guid currentUserId,
        Guid targetUserId,
        CancellationToken ct = default);

    Task UnblockUserAsync(
        Guid currentUserId,
        Guid targetUserId,
        CancellationToken ct = default);

    Task<FriendUserListResponse> GetBlockedUsersAsync(
        Guid currentUserId,
        int page,
        int pageSize,
        CancellationToken ct = default);
}