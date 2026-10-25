using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using WebChat.Api.Data;
using WebChat.Api.DTOs.Auth;
using WebChat.Api.Models;

namespace WebChat.Api.Services.Auth;

public sealed class AuthService : IAuthService
{
    private static readonly TimeSpan RefreshLifetime =
        TimeSpan.FromDays(7);

    private readonly AppDbContext _dbContext;
    private readonly IPasswordHasher<User> _passwordHasher;
    private readonly IJwtTokenService _jwtTokenService;

    public AuthService(
        AppDbContext dbContext,
        IPasswordHasher<User> passwordHasher,
        IJwtTokenService jwtTokenService)
    {
        _dbContext = dbContext;
        _passwordHasher = passwordHasher;
        _jwtTokenService = jwtTokenService;
    }

    // =====================================================
    // REGISTER - GIỮ NGUYÊN BƯỚC 3.2
    // =====================================================

    public async Task<RegisterResponse> RegisterAsync(
        RegisterRequest request,
        CancellationToken cancellationToken = default)
    {
        var username = request.Username.Trim();
        var email = request.Email.Trim();
        var displayName = request.DisplayName.Trim();

        if (username.Length < 3 ||
            username.Length > 50 ||
            !Regex.IsMatch(username, @"^[a-zA-Z0-9_]+$"))
        {
            throw new ArgumentException(
                "Username phải có 3-50 ký tự, " +
                "chỉ chứa chữ, số hoặc dấu gạch dưới.");
        }

        if (string.IsNullOrWhiteSpace(displayName) ||
            displayName.Length > 100)
        {
            throw new ArgumentException(
                "Tên hiển thị không hợp lệ.");
        }

        var normalizedUsername = username.ToUpperInvariant();
        var normalizedEmail = email.ToUpperInvariant();

        if (await _dbContext.Users.AnyAsync(
                x => x.NormalizedUsername == normalizedUsername,
                cancellationToken))
        {
            throw new InvalidOperationException(
                "Username đã được sử dụng.");
        }

        if (await _dbContext.Users.AnyAsync(
                x => x.NormalizedEmail == normalizedEmail,
                cancellationToken))
        {
            throw new InvalidOperationException(
                "Email đã được sử dụng.");
        }

        var userRole = await _dbContext.Roles
            .AsNoTracking()
            .FirstOrDefaultAsync(
                x => x.NormalizedName == "USER"
                     && x.IsActive
                     && x.IsSystem,
                cancellationToken);

        if (userRole is null)
        {
            throw new InvalidOperationException(
                "Role mặc định User chưa được cấu hình.");
        }

        var user = new User
        {
            Id = Guid.NewGuid(),
            Username = username,
            NormalizedUsername = normalizedUsername,
            Email = email,
            NormalizedEmail = normalizedEmail,
            DisplayName = displayName,
            IsActive = true,
            IsEmailVerified = false,
            CreatedAtUtc = DateTime.UtcNow
        };

        user.PasswordHash = _passwordHasher.HashPassword(
            user, request.Password);

        user.UserRoles.Add(new UserRole
        {
            UserId = user.Id,
            RoleId = userRole.Id,
            AssignedAtUtc = DateTime.UtcNow
        });

        _dbContext.Users.Add(user);

        try
        {
            await _dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException ex)
            when (ex.InnerException is SqlException sqlEx &&
                  (sqlEx.Number == 2601 || sqlEx.Number == 2627))
        {
            throw new InvalidOperationException(
                "Username hoặc email đã được sử dụng.", ex);
        }

        return new RegisterResponse
        {
            Id = user.Id,
            Username = user.Username,
            Email = user.Email,
            DisplayName = user.DisplayName,
            CreatedAtUtc = user.CreatedAtUtc
        };
    }

    // =====================================================
    // LOGIN
    // =====================================================

    public async Task<AuthIssuedResult?> LoginAsync(
        LoginRequest request,
        string? ipAddress,
        string? userAgent,
        CancellationToken cancellationToken = default)
    {
        var identifier = request.Identifier.Trim()
            .ToUpperInvariant();

        var user = await _dbContext.Users
            .AsNoTracking()
            .FirstOrDefaultAsync(
                x => x.NormalizedUsername == identifier ||
                     x.NormalizedEmail == identifier,
                cancellationToken);

        if (user is null || !user.IsActive)
        {
            return null;
        }

        var passwordResult =
            _passwordHasher.VerifyHashedPassword(
                user,
                user.PasswordHash,
                request.Password);

        if (passwordResult == PasswordVerificationResult.Failed)
        {
            return null;
        }

        var roles = await GetActiveRolesAsync(
            user.Id, cancellationToken);

        if (roles.Count == 0)
        {
            return null;
        }

        var now = DateTime.UtcNow;

        var session = new UserSession
        {
            Id = Guid.NewGuid(),
            UserId = user.Id,
            IpAddress = Limit(ipAddress, 45),
            UserAgent = Limit(userAgent, 1024),
            DeviceName = "Web browser",
            CreatedAtUtc = now,
            LastActivityAtUtc = now
        };

        var rawRefreshToken = GenerateRefreshToken();

        var refreshToken = new RefreshToken
        {
            Id = Guid.NewGuid(),
            UserId = user.Id,
            SessionId = session.Id,
            TokenHash = HashRefreshToken(rawRefreshToken),
            CreatedAtUtc = now,
            ExpiresAtUtc = now.Add(RefreshLifetime)
        };

        _dbContext.UserSessions.Add(session);
        _dbContext.RefreshTokens.Add(refreshToken);

        // EF Core lưu hai bản ghi trong một transaction.
        await _dbContext.SaveChangesAsync(cancellationToken);

        return IssueTokens(
            user, roles, session.Id, rawRefreshToken);
    }

    // =====================================================
    // REFRESH TOKEN ROTATION
    // =====================================================

    public async Task<AuthIssuedResult?> RefreshAsync(
        string refreshToken,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(refreshToken) ||
            refreshToken.Length > 1024)
        {
            return null;
        }

        var tokenHash = HashRefreshToken(refreshToken);
        var now = DateTime.UtcNow;

        var storedToken = await _dbContext.RefreshTokens
            .AsNoTracking()
            .Include(x => x.Session)
            .Include(x => x.User)
            .FirstOrDefaultAsync(
                x => x.TokenHash == tokenHash,
                cancellationToken);

        if (storedToken is null ||
            storedToken.RevokedAtUtc is not null ||
            storedToken.ExpiresAtUtc <= now ||
            storedToken.Session.RevokedAtUtc is not null ||
            !storedToken.User.IsActive ||
            storedToken.Session.UserId != storedToken.UserId)
        {
            return null;
        }

        var roles = await GetActiveRolesAsync(
            storedToken.UserId, cancellationToken);

        if (roles.Count == 0)
        {
            return null;
        }

        var newRawToken = GenerateRefreshToken();
        var newTokenHash = HashRefreshToken(newRawToken);

        // Dùng transaction và cập nhật có điều kiện để
        // không cho hai request dùng cùng Refresh Token.
        await using var transaction =
            await _dbContext.Database.BeginTransactionAsync(
                cancellationToken);

        var updated = await _dbContext.RefreshTokens
            .Where(x =>
                x.Id == storedToken.Id &&
                x.RevokedAtUtc == null &&
                x.ExpiresAtUtc > now)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(x => x.RevokedAtUtc, now)
                .SetProperty(
                    x => x.ReplacedByTokenHash,
                    newTokenHash),
                cancellationToken);

        if (updated != 1)
        {
            await transaction.RollbackAsync(cancellationToken);
            return null;
        }

        var activeSession = await _dbContext.UserSessions
            .Where(x =>
                x.Id == storedToken.SessionId &&
                x.RevokedAtUtc == null)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(
                    x => x.LastActivityAtUtc, now),
                cancellationToken);

        if (activeSession != 1)
        {
            await transaction.RollbackAsync(cancellationToken);
            return null;
        }

        _dbContext.RefreshTokens.Add(new RefreshToken
        {
            Id = Guid.NewGuid(),
            UserId = storedToken.UserId,
            SessionId = storedToken.SessionId,
            TokenHash = newTokenHash,
            CreatedAtUtc = now,
            ExpiresAtUtc = now.Add(RefreshLifetime)
        });

        await _dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        return IssueTokens(
            storedToken.User,
            roles,
            storedToken.SessionId,
            newRawToken);
    }

    // =====================================================
    // LOGOUT CURRENT SESSION
    // =====================================================

    public async Task LogoutAsync(
        string refreshToken,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(refreshToken) ||
            refreshToken.Length > 1024)
        {
            return;
        }

        var tokenHash = HashRefreshToken(refreshToken);

        var sessionId = await _dbContext.RefreshTokens
            .AsNoTracking()
            .Where(x => x.TokenHash == tokenHash)
            .Select(x => (Guid?)x.SessionId)
            .FirstOrDefaultAsync(cancellationToken);

        if (sessionId is null)
        {
            return;
        }

        var now = DateTime.UtcNow;

        await using var transaction =
            await _dbContext.Database.BeginTransactionAsync(
                cancellationToken);

        await _dbContext.UserSessions
            .Where(x =>
                x.Id == sessionId.Value &&
                x.RevokedAtUtc == null)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(x => x.RevokedAtUtc, now),
                cancellationToken);

        await _dbContext.RefreshTokens
            .Where(x =>
                x.SessionId == sessionId.Value &&
                x.RevokedAtUtc == null)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(x => x.RevokedAtUtc, now),
                cancellationToken);

        await transaction.CommitAsync(cancellationToken);
    }

    // =====================================================
    // GET CURRENT USER
    // =====================================================

    public async Task<LoginUserResponse?> GetMeAsync(
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

        var roles = await GetActiveRolesAsync(
            user.Id, cancellationToken);

        return new LoginUserResponse
        {
            Id = user.Id,
            Username = user.Username,
            Email = user.Email,
            DisplayName = user.DisplayName,
            AvatarUrl = user.AvatarUrl,
            Roles = roles
        };
    }

    // =====================================================
    // PRIVATE HELPERS
    // =====================================================

    private async Task<List<string>> GetActiveRolesAsync(
        Guid userId,
        CancellationToken cancellationToken)
    {
        return await _dbContext.UserRoles
            .AsNoTracking()
            .Where(x =>
                x.UserId == userId &&
                x.Role.IsActive)
            .Select(x => x.Role.Name)
            .ToListAsync(cancellationToken);
    }

    private AuthIssuedResult IssueTokens(
        User user,
        IReadOnlyCollection<string> roles,
        Guid sessionId,
        string rawRefreshToken)
    {
        var (accessToken, expiresAtUtc) =
            _jwtTokenService.GenerateAccessToken(
                user, roles, sessionId);

        var response = new LoginResponse
        {
            AccessToken = accessToken,
            TokenType = "Bearer",
            ExpiresAtUtc = expiresAtUtc,
            User = new LoginUserResponse
            {
                Id = user.Id,
                Username = user.Username,
                Email = user.Email,
                DisplayName = user.DisplayName,
                AvatarUrl = user.AvatarUrl,
                Roles = roles.ToList()
            }
        };

        return new AuthIssuedResult(
            response, rawRefreshToken);
    }

    private static string GenerateRefreshToken()
    {
        return WebEncoders.Base64UrlEncode(
            RandomNumberGenerator.GetBytes(64));
    }

    private static string HashRefreshToken(string token)
    {
        var bytes = SHA256.HashData(
            Encoding.UTF8.GetBytes(token));

        return Convert.ToHexString(bytes);
    }

    private static string? Limit(string? value, int length)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        return value.Length <= length
            ? value
            : value[..length];
    }
}