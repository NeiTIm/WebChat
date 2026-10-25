using WebChat.Api.DTOs.Auth;

namespace WebChat.Api.Services.Auth;

public interface IAuthService
{
    Task<RegisterResponse> RegisterAsync(
        RegisterRequest request,
        CancellationToken cancellationToken = default);

    Task<AuthIssuedResult?> LoginAsync(
        LoginRequest request,
        string? ipAddress,
        string? userAgent,
        CancellationToken cancellationToken = default);

    Task<AuthIssuedResult?> RefreshAsync(
        string refreshToken,
        CancellationToken cancellationToken = default);

    Task LogoutAsync(
        string refreshToken,
        CancellationToken cancellationToken = default);

    Task<LoginUserResponse?> GetMeAsync(
        Guid userId,
        CancellationToken cancellationToken = default);
}