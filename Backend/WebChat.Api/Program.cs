
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

using WebChat.Api.Data;
using WebChat.Api.Data.Seed;
using WebChat.Api.Hubs;
using WebChat.Api.Models;
using WebChat.Api.Options;
using WebChat.Api.Realtime;
using WebChat.Api.Services.Auth;
using WebChat.Api.Services.Conversations;
using WebChat.Api.Services.Friends;
using WebChat.Api.Services.Messages;
using WebChat.Api.Services.Users;

var builder = WebApplication.CreateBuilder(args);

// =====================================================
// CONTROLLERS + OPENAPI
// =====================================================

builder.Services.AddControllers();
builder.Services.AddOpenApi();

// =====================================================
// SIGNALR - PHASE 5.7.2
// =====================================================

builder.Services.AddSignalR();

builder.Services.AddScoped<
    IChatRealtimePublisher,
    ChatRealtimePublisher>();

// SignalR dùng ClaimTypes.NameIdentifier làm UserId.
// Guid được chuẩn hóa theo định dạng "D" để đồng nhất
// với UserId sử dụng trong Realtime Publisher.
builder.Services.AddSingleton<
    IUserIdProvider,
    ChatUserIdProvider>();

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
    builder.Configuration.GetSection(
        JwtOptions.SectionName));

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
        "Jwt:AccessTokenMinutes phải nằm " +
        "trong khoảng 1-60.");
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
    .AddAuthentication(
        JwtBearerDefaults.AuthenticationScheme)
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

                ValidAlgorithms =
                [
                    SecurityAlgorithms.HmacSha256
                ],

                ClockSkew =
                    TimeSpan.FromSeconds(30),

                NameClaimType = ClaimTypes.Name,
                RoleClaimType = ClaimTypes.Role
            };

        // Khi JWT hết hạn, đóng kết nối SignalR.
        // Client sẽ lấy token mới và reconnect.
        options.Events = new JwtBearerEvents
        {
            // =================================================
            // SIGNALR ACCESS TOKEN
            // =================================================

            OnMessageReceived = context =>
            {
                // Chỉ nhận access_token từ query string
                // trên đúng endpoint SignalR.
                // REST API không nhận JWT từ query string.
                var path = context.HttpContext.Request.Path;

                if (path.StartsWithSegments("/hubs/chat"))
                {
                    var queryToken =
                        context.Request.Query["access_token"];

                    if (!string.IsNullOrWhiteSpace(queryToken))
                    {
                        context.Token = queryToken;
                    }
                }

                return Task.CompletedTask;
            },

            // =================================================
            // VALIDATE USER SESSION + ROLES
            // =================================================

            OnTokenValidated = async context =>
            {
                var userIdText = context.Principal?
                    .FindFirstValue(
                        ClaimTypes.NameIdentifier);

                var sessionIdText = context.Principal?
                    .FindFirstValue("sid");

                if (!Guid.TryParse(
                        userIdText,
                        out var userId) ||
                    !Guid.TryParse(
                        sessionIdText,
                        out var sessionId))
                {
                    context.Fail(
                        "Invalid user or session ID.");
                    return;
                }

                var db = context.HttpContext
                    .RequestServices
                    .GetRequiredService<AppDbContext>();

                // Session phải còn hiệu lực và
                // tài khoản phải đang hoạt động.
                var validSession = await db.UserSessions
                    .AsNoTracking()
                    .AnyAsync(
                        x =>
                            x.Id == sessionId &&
                            x.UserId == userId &&
                            x.RevokedAtUtc == null &&
                            x.User.IsActive,
                        context.HttpContext.RequestAborted);

                if (!validSession)
                {
                    context.Fail(
                        "Session revoked or invalid.");
                    return;
                }

                // Luôn dùng Role đang hoạt động từ DB,
                // không tin Role cũ bên trong JWT.
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
                    .FindAll(ClaimTypes.Role)
                    .ToList())
                {
                    identity.RemoveClaim(claim);
                }

                foreach (var role in roles)
                {
                    identity.AddClaim(
                        new Claim(
                            ClaimTypes.Role,
                            role));
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

builder.Services.AddScoped<
    IAuthService,
    AuthService>();

builder.Services.AddScoped<
    IPasswordHasher<User>,
    PasswordHasher<User>>();

builder.Services.AddSingleton<
    IJwtTokenService,
    JwtTokenService>();

builder.Services.AddScoped<
    IUserService,
    UserService>();

builder.Services.AddScoped<
    IFriendRequestService,
    FriendRequestService>();

builder.Services.AddScoped<
    IFriendRelationshipService,
    FriendRelationshipService>();

builder.Services.AddScoped<
    IFriendStatusService,
    FriendStatusService>();

// =====================================================
// CONVERSATIONS - PHASE 5
// =====================================================

builder.Services.AddScoped<
    IConversationService,
    ConversationService>();

// =====================================================
// MESSAGES - PHASE 5.5
// =====================================================

builder.Services.AddScoped<
    IMessageService,
    MessageService>();
builder.Services.AddSingleton<IPresenceService, PresenceService>();
// =====================================================
// CORS - REACT + SIGNALR
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

// SignalR endpoint phải yêu cầu đăng nhập.
app.MapHub<ChatHub>(
    "/hubs/chat",
    options =>
    {
        options.CloseOnAuthenticationExpiration = true;
    })
    .RequireAuthorization();

app.Run();
