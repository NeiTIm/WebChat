using WebChat.Api.Models;

namespace WebChat.Api.Services.Auth;

public interface IJwtTokenService
{
    (string Token, DateTime ExpiresAtUtc) GenerateAccessToken(
        User user,
        IReadOnlyCollection<string> roles,
        Guid sessionId);
}