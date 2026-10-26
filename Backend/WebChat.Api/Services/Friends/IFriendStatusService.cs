using WebChat.Api.DTOs.Friends;

namespace WebChat.Api.Services.Friends;

public interface IFriendStatusService
{
    Task<FriendStatusesResponse> GetStatusesAsync(
        Guid currentUserId,
        IReadOnlyCollection<Guid> userIds,
        CancellationToken ct = default);
}