using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using WebChat.Api.DTOs.Auth;
using WebChat.Api.Services.Auth;

namespace WebChat.Api.Controllers;

[ApiController]
[Route("api/auth")]
public sealed class AuthController : ControllerBase
{
    private const string RefreshCookie = "webchat_refresh";

    private readonly IAuthService _authService;
    private readonly IWebHostEnvironment _environment;

    public AuthController(
        IAuthService authService,
        IWebHostEnvironment environment)
    {
        _authService = authService;
        _environment = environment;
    }

    // =====================================================
    // REGISTER
    // =====================================================

    [AllowAnonymous]
    [HttpPost("register")]
    public async Task<ActionResult<RegisterResponse>> Register(
        [FromBody] RegisterRequest request,
        CancellationToken cancellationToken)
    {
        try
        {
            var result = await _authService.RegisterAsync(
                request, cancellationToken);

            return StatusCode(
                StatusCodes.Status201Created, result);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new
            {
                success = false,
                message = ex.Message
            });
        }
        catch (InvalidOperationException ex)
        {
            return Conflict(new
            {
                success = false,
                message = ex.Message
            });
        }
    }

    // =====================================================
    // LOGIN
    // =====================================================

    [AllowAnonymous]
    [HttpPost("login")]
    public async Task<ActionResult<LoginResponse>> Login(
        [FromBody] LoginRequest request,
        CancellationToken cancellationToken)
    {
        var issued = await _authService.LoginAsync(
            request,
            HttpContext.Connection.RemoteIpAddress?.ToString(),
            Request.Headers.UserAgent.ToString(),
            cancellationToken);

        if (issued is null)
        {
            return Unauthorized(new
            {
                success = false,
                message = "Thông tin đăng nhập không hợp lệ."
            });
        }

        SetRefreshCookie(issued.RefreshToken);

        return Ok(issued.Result);
    }

    // =====================================================
    // REFRESH TOKEN
    // =====================================================

    [AllowAnonymous]
    [HttpPost("refresh")]
    public async Task<ActionResult<LoginResponse>> Refresh(
        CancellationToken cancellationToken)
    {
        if (!IsTrustedOrigin())
        {
            return StatusCode(403, new
            {
                success = false,
                message = "Origin không được phép."
            });
        }

        var token = Request.Cookies[RefreshCookie];

        if (string.IsNullOrWhiteSpace(token))
        {
            return Unauthorized(new
            {
                success = false,
                message = "Không tìm thấy Refresh Token."
            });
        }

        var issued = await _authService.RefreshAsync(
            token, cancellationToken);

        if (issued is null)
        {
            ClearRefreshCookie();

            return Unauthorized(new
            {
                success = false,
                message = "Refresh Token không hợp lệ hoặc đã hết hạn."
            });
        }

        SetRefreshCookie(issued.RefreshToken);

        return Ok(issued.Result);
    }

    // =====================================================
    // LOGOUT
    // =====================================================

    [AllowAnonymous]
    [HttpPost("logout")]
    public async Task<IActionResult> Logout(
        CancellationToken cancellationToken)
    {
        if (!IsTrustedOrigin())
        {
            return StatusCode(403, new
            {
                success = false,
                message = "Origin không được phép."
            });
        }

        var token = Request.Cookies[RefreshCookie];

        if (!string.IsNullOrWhiteSpace(token))
        {
            await _authService.LogoutAsync(
                token, cancellationToken);
        }

        ClearRefreshCookie();

        return Ok(new
        {
            success = true,
            message = "Đăng xuất thành công."
        });
    }

    // =====================================================
    // GET ME
    // =====================================================

    [Authorize]
    [HttpGet("me")]
    public async Task<IActionResult> GetMe(
        CancellationToken cancellationToken)
    {
        var idText = User.FindFirstValue(
            ClaimTypes.NameIdentifier);

        if (!Guid.TryParse(idText, out var userId))
        {
            return Unauthorized();
        }

        var result = await _authService.GetMeAsync(
            userId, cancellationToken);

        return result is null
            ? Unauthorized()
            : Ok(result);
    }

    // =====================================================
    // VERIFY JWT
    // =====================================================

    [Authorize]
    [HttpGet("verify")]
    public IActionResult Verify()
    {
        return Ok(new
        {
            success = true,
            message = "JWT hợp lệ.",
            userId = User.FindFirstValue(
                ClaimTypes.NameIdentifier),
            username = User.Identity?.Name,
            roles = User.FindAll(ClaimTypes.Role)
                .Select(x => x.Value)
                .ToArray()
        });
    }

    // =====================================================
    // ADMIN CHECK
    // =====================================================

    [Authorize(Roles = "Admin")]
    [HttpGet("admin-check")]
    public IActionResult AdminCheck()
    {
        return Ok(new
        {
            success = true,
            message = "Bạn có quyền Admin."
        });
    }

    // =====================================================
    // COOKIE HELPERS
    // =====================================================

    private void SetRefreshCookie(string token)
    {
        Response.Cookies.Append(
            RefreshCookie,
            token,
            new CookieOptions
            {
                HttpOnly = true,
                Secure = !_environment.IsDevelopment(),
                SameSite = SameSiteMode.Strict,
                Path = "/api/auth",
                MaxAge = TimeSpan.FromDays(7),
                IsEssential = true
            });
    }

    private void ClearRefreshCookie()
    {
        Response.Cookies.Delete(
            RefreshCookie,
            new CookieOptions
            {
                HttpOnly = true,
                Secure = !_environment.IsDevelopment(),
                SameSite = SameSiteMode.Strict,
                Path = "/api/auth"
            });
    }

    private bool IsTrustedOrigin()
    {
        var origin = Request.Headers.Origin.ToString();

        // Requests không có Origin, ví dụ Postman/CMD,
        // vẫn được chấp nhận.
        if (string.IsNullOrWhiteSpace(origin))
        {
            return true;
        }

        return origin is
            "http://localhost:5173" or
            "http://127.0.0.1:5173";
    }
}