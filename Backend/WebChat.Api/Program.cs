using System.Security.Claims;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using WebChat.Api.Data;
using WebChat.Api.Data.Seed;
using WebChat.Api.Models;
using WebChat.Api.Options;
using WebChat.Api.Services.Auth;
using WebChat.Api.Services.Users;
using WebChat.Api.Services.Friends;
var builder = WebApplication.CreateBuilder(args);

// =====================================================
// CONTROLLERS + OPENAPI
// =====================================================

builder.Services.AddControllers();
builder.Services.AddOpenApi();

// =====================================================
// SQL SERVER
// =====================================================

var connectionString = builder.Configuration
    .GetConnectionString("DefaultConnection")
    ?? throw new InvalidOperationException(
        "Không tìm thấy DefaultConnection.");

builder.Services.AddDbContext<AppDbContext>(options =>
{
    options.UseSqlServer(connectionString);
});

// =====================================================
// JWT OPTIONS
// =====================================================

builder.Services.Configure<JwtOptions>(
    builder.Configuration.GetSection(JwtOptions.SectionName));

var jwtOptions = builder.Configuration
    .GetSection(JwtOptions.SectionName)
    .Get<JwtOptions>()
    ?? throw new InvalidOperationException(
        "Thiếu cấu hình JWT.");

if (string.IsNullOrWhiteSpace(jwtOptions.Issuer) ||
    string.IsNullOrWhiteSpace(jwtOptions.Audience))
{
    throw new InvalidOperationException(
        "Jwt:Issuer và Jwt:Audience là bắt buộc.");
}

if (jwtOptions.AccessTokenMinutes is < 1 or > 60)
{
    throw new InvalidOperationException(
        "Jwt:AccessTokenMinutes phải nằm trong khoảng 1-60.");
}

byte[] jwtKeyBytes;

try
{
    jwtKeyBytes = Convert.FromBase64String(
        jwtOptions.SecretKey);
}
catch (FormatException)
{
    throw new InvalidOperationException(
        "Jwt:SecretKey phải là Base64 hợp lệ.");
}

if (jwtKeyBytes.Length < 32)
{
    throw new InvalidOperationException(
        "Jwt:SecretKey cần tối thiểu 32 byte.");
}

var signingKey = new SymmetricSecurityKey(
    jwtKeyBytes);

// =====================================================
// JWT AUTHENTICATION
// =====================================================

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.MapInboundClaims = false;

        options.TokenValidationParameters =
            new TokenValidationParameters
            {
                ValidateIssuer = true,
                ValidIssuer = jwtOptions.Issuer,

                ValidateAudience = true,
                ValidAudience = jwtOptions.Audience,

                ValidateIssuerSigningKey = true,
                IssuerSigningKey = signingKey,

                ValidateLifetime = true,
                RequireExpirationTime = true,
                RequireSignedTokens = true,

                ValidAlgorithms = new[]
                {
                    SecurityAlgorithms.HmacSha256
                },

                ClockSkew = TimeSpan.FromSeconds(30),

                NameClaimType = ClaimTypes.Name,
                RoleClaimType = ClaimTypes.Role
            };

        options.Events = new JwtBearerEvents
        {
            OnTokenValidated = async context =>
            {
                var userIdText = context.Principal?
                    .FindFirstValue(ClaimTypes.NameIdentifier);

                var sessionIdText = context.Principal?
                    .FindFirstValue("sid");

                if (!Guid.TryParse(userIdText, out var userId) ||
                    !Guid.TryParse(sessionIdText, out var sessionId))
                {
                    context.Fail("Invalid user or session ID.");
                    return;
                }

                var db = context.HttpContext.RequestServices
                    .GetRequiredService<AppDbContext>();

                // Session phải tồn tại, chưa bị thu hồi
                // và thuộc User đang hoạt động.
                var validSession = await db.UserSessions
                    .AsNoTracking()
                    .AnyAsync(
                        x => x.Id == sessionId &&
                             x.UserId == userId &&
                             x.RevokedAtUtc == null &&
                             x.User.IsActive,
                        context.HttpContext.RequestAborted);

                if (!validSession)
                {
                    context.Fail("Session revoked or invalid.");
                    return;
                }

                // Không tin Role cũ trong JWT.
                var roles = await db.UserRoles
                    .AsNoTracking()
                    .Where(x =>
                        x.UserId == userId &&
                        x.Role.IsActive)
                    .Select(x => x.Role.Name)
                    .ToListAsync(
                        context.HttpContext.RequestAborted);

                if (roles.Count == 0)
                {
                    context.Fail("No active role.");
                    return;
                }

                if (context.Principal?.Identity
                    is not ClaimsIdentity identity)
                {
                    context.Fail("Invalid identity.");
                    return;
                }

                foreach (var claim in identity
                    .FindAll(ClaimTypes.Role).ToList())
                {
                    identity.RemoveClaim(claim);
                }

                foreach (var role in roles)
                {
                    identity.AddClaim(
                        new Claim(ClaimTypes.Role, role));
                }
            }
        };
    });

// =====================================================
// AUTHORIZATION
// =====================================================

builder.Services.AddAuthorization();

// =====================================================
// APPLICATION SERVICES
// =====================================================

builder.Services.AddScoped<IAuthService, AuthService>();

builder.Services.AddScoped<
    IPasswordHasher<User>,
    PasswordHasher<User>>();

builder.Services.AddSingleton<
    IJwtTokenService,
    JwtTokenService>();
builder.Services.AddScoped<IUserService, UserService>();
builder.Services.AddScoped<
    IFriendRequestService,
    FriendRequestService>();
// Bước 4.4 - Friendship & Block Management
builder.Services.AddScoped<
    IFriendRelationshipService,
    FriendRelationshipService>();
builder.Services.AddScoped<
IFriendStatusService,
FriendStatusService>();
// =====================================================
// CORS - REACT
// =====================================================

builder.Services.AddCors(options =>
{
    options.AddPolicy("ReactApp", policy =>
    {
        policy.WithOrigins(
                "http://localhost:5173",
                "http://127.0.0.1:5173")
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials();
    });
});

// =====================================================
// BUILD
// =====================================================

var app = builder.Build();

// =====================================================
// OPENAPI
// =====================================================

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

// =====================================================
// SEED SYSTEM ROLES (DEVELOPMENT)
// =====================================================

if (app.Environment.IsDevelopment())
{
    using var scope = app.Services.CreateScope();

    var dbContext = scope.ServiceProvider
        .GetRequiredService<AppDbContext>();

    await RoleSeeder.SeedAsync(dbContext);
}

// =====================================================
// MIDDLEWARE
// =====================================================

app.UseCors("ReactApp");

app.UseAuthentication();

app.UseAuthorization();

// =====================================================
// ENDPOINTS
// =====================================================

app.MapControllers();

app.Run();