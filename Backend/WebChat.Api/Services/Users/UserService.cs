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

    // =====================================================
    // GET MY PROFILE - GIỮ NGUYÊN
    // =====================================================

    public async Task<UserProfileResponse?> GetMyProfileAsync(
        Guid userId,
        CancellationToken cancellationToken = default)
    {
        var user = await _dbContext.Users
            .AsNoTracking()
            .FirstOrDefaultAsync(
                x => x.Id == userId && x.IsActive,
                cancellationToken);

        return user is null ? null : MapToResponse(user);
    }

    // =====================================================
    // UPDATE MY PROFILE - GIỮ NGUYÊN
    // =====================================================

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
        user.Bio = string.IsNullOrWhiteSpace(bio) ? null : bio;
        user.AvatarUrl = string.IsNullOrWhiteSpace(avatarUrl)
            ? null : avatarUrl;
        user.UpdatedAtUtc = DateTime.UtcNow;

        await _dbContext.SaveChangesAsync(cancellationToken);

        return MapToResponse(user);
    }

    // =====================================================
    // USER DISCOVERY + LIVE SEARCH
    // =====================================================

    public async Task<UserSearchResponse> SearchUsersAsync(
        Guid currentUserId,
        string query,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default)
    {
        var keyword = (query ?? string.Empty).Trim();

        // Không nhập gì => hiển thị danh sách mặc định.
        // Có từ khóa => lọc ngay cả với một ký tự.
        if (keyword.Length > 80)
        {
            throw new ArgumentException(
                "Từ khóa không được vượt quá 80 ký tự.");
        }

        if (page < 1 || page > 100000)
        {
            throw new ArgumentException(
                "Số trang không hợp lệ.");
        }

        if (pageSize is < 20 or > 50)
        {
            throw new ArgumentException(
                "PageSize phải nằm trong khoảng 20 đến 50.");
        }

        // Luôn chỉ lấy user Active và loại trừ chính mình.
        IQueryable<User> usersQuery = _dbContext.Users
            .AsNoTracking()
            .Where(x =>
                x.IsActive &&
                x.Id != currentUserId);

        // Chỉ thêm điều kiện LIKE khi có từ khóa.
        if (!string.IsNullOrEmpty(keyword))
        {
            var escapedKeyword = EscapeLike(keyword);
            var pattern = $"%{escapedKeyword}%";

            usersQuery = usersQuery.Where(x =>
                EF.Functions.Like(
                    x.Username,
                    pattern,
                    "\\") ||
                EF.Functions.Like(
                    x.DisplayName,
                    pattern,
                    "\\"));
        }

        var total = await usersQuery.CountAsync(
            cancellationToken);

        var items = await usersQuery
            .OrderBy(x => x.DisplayName)
            .ThenBy(x => x.Username)
            .ThenBy(x => x.Id)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(x => new UserSearchItemResponse
            {
                Id = x.Id,
                Username = x.Username,
                DisplayName = x.DisplayName,
                AvatarUrl = x.AvatarUrl,
                Bio = x.Bio
            })
            .ToListAsync(cancellationToken);

        var totalPages = total == 0
            ? 0
            : (int)Math.Ceiling(
                (double)total / pageSize);

        return new UserSearchResponse
        {
            Items = items,
            Page = page,
            PageSize = pageSize,
            Total = total,
            TotalPages = totalPages,
            HasPreviousPage = page > 1,
            HasNextPage = page < totalPages
        };
    }

    // =====================================================
    // SQL LIKE ESCAPING
    // =====================================================

    private static string EscapeLike(string value)
    {
        return value
            .Replace("\\", "\\\\")
            .Replace("%", "\\%")
            .Replace("_", "\\_")
            .Replace("[", "\\[");
    }

    // =====================================================
    // PROFILE RESPONSE MAPPER - GIỮ NGUYÊN
    // =====================================================

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