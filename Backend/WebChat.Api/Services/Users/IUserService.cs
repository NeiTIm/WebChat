using WebChat.Api.DTOs.Users;

namespace WebChat.Api.Services.Users;

public interface IUserService
{
    Task<UserProfileResponse?> GetMyProfileAsync(
        Guid userId,
        CancellationToken cancellationToken = default);

    Task<UserProfileResponse?> UpdateMyProfileAsync(
        Guid userId,
        UpdateUserProfileRequest request,
        CancellationToken cancellationToken = default);
}