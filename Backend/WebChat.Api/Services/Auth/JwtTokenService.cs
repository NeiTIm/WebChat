using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using WebChat.Api.Models;
using WebChat.Api.Options;

namespace WebChat.Api.Services.Auth;

public sealed class JwtTokenService : IJwtTokenService
{
    private readonly JwtOptions _options;
    private readonly SymmetricSecurityKey _signingKey;

    public JwtTokenService(IOptions<JwtOptions> options)
    {
        _options = options.Value;

        _signingKey = new SymmetricSecurityKey(
            Convert.FromBase64String(_options.SecretKey));
    }

    public (string Token, DateTime ExpiresAtUtc) GenerateAccessToken(
        User user,
        IReadOnlyCollection<string> roles,
        Guid sessionId)
    {
        var now = DateTime.UtcNow;

        var expiresAtUtc = now.AddMinutes(
            _options.AccessTokenMinutes);

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, user.Id.ToString()),

            new(ClaimTypes.NameIdentifier, user.Id.ToString()),

            new(ClaimTypes.Name, user.Username),

            new("sid", sessionId.ToString()),

            new(JwtRegisteredClaimNames.Jti,
                Guid.NewGuid().ToString("N"))
        };

        foreach (var role in roles.Distinct(
                     StringComparer.OrdinalIgnoreCase))
        {
            claims.Add(new Claim(ClaimTypes.Role, role));
        }

        var credentials = new SigningCredentials(
            _signingKey,
            SecurityAlgorithms.HmacSha256);

        var jwt = new JwtSecurityToken(
            issuer: _options.Issuer,
            audience: _options.Audience,
            claims: claims,
            notBefore: now,
            expires: expiresAtUtc,
            signingCredentials: credentials);

        return (
            new JwtSecurityTokenHandler().WriteToken(jwt),
            expiresAtUtc
        );
    }
}