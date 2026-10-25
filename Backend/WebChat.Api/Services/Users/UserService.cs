using Microsoft.EntityFrameworkCore;
using WebChat.Api.Data;
using WebChat.Api.DTOs.Users;
using WebChat.Api.Models;

namespace WebChat.Api.Services.Users;

public sealed class UserService : IUserService
{
    private readonly AppDbContext _dbContext;

    public UserService(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    public async Task<UserProfileResponse?> GetMyProfileAsync(
        Guid userId,
        CancellationToken cancellationToken = default)
    {
        var user = await _dbContext.Users
            .AsNoTracking()
            .FirstOrDefaultAsync(
                x => x.Id == userId && x.IsActive,
                cancellationToken);

        if (user is null)
        {
            return null;
        }

        return MapToResponse(user);
    }

    public async Task<UserProfileResponse?> UpdateMyProfileAsync(
        Guid userId,
        UpdateUserProfileRequest request,
        CancellationToken cancellationToken = default)
    {
        var user = await _dbContext.Users
            .FirstOrDefaultAsync(
                x => x.Id == userId && x.IsActive,
                cancellationToken);

        if (user is null)
        {
            return null;
        }

        var displayName = request.DisplayName.Trim();
        var bio = request.Bio?.Trim();
        var avatarUrl = request.AvatarUrl?.Trim();

        if (displayName.Length is < 2 or > 100)
        {
            throw new ArgumentException(
                "Tên hiển thị phải có từ 2 đến 100 ký tự.");
        }

        if (bio?.Length > 500)
        {
            throw new ArgumentException(
                "Giới thiệu không được vượt quá 500 ký tự.");
        }

        if (!string.IsNullOrEmpty(avatarUrl))
        {
            if (avatarUrl.Length > 2048 ||
                !Uri.TryCreate(
                    avatarUrl,
                    UriKind.Absolute,
                    out var uri) ||
                (uri.Scheme != Uri.UriSchemeHttp &&
                 uri.Scheme != Uri.UriSchemeHttps) ||
                string.IsNullOrWhiteSpace(uri.Host) ||
                !string.IsNullOrEmpty(uri.UserInfo))
            {
                throw new ArgumentException(
                    "Ảnh đại diện phải là URL HTTP hoặc HTTPS hợp lệ.");
            }
        }

        user.DisplayName = displayName;

        user.Bio = string.IsNullOrWhiteSpace(bio)
            ? null
            : bio;

        user.AvatarUrl = string.IsNullOrWhiteSpace(avatarUrl)
            ? null
            : avatarUrl;

        user.UpdatedAtUtc = DateTime.UtcNow;

        await _dbContext.SaveChangesAsync(cancellationToken);

        return MapToResponse(user);
    }

    private static UserProfileResponse MapToResponse(User user)
    {
        return new UserProfileResponse
        {
            Id = user.Id,
            Username = user.Username,
            Email = user.Email,
            DisplayName = user.DisplayName,
            AvatarUrl = user.AvatarUrl,
            Bio = user.Bio,
            IsEmailVerified = user.IsEmailVerified,
            CreatedAtUtc = user.CreatedAtUtc,
            UpdatedAtUtc = user.UpdatedAtUtc
        };
    }
}