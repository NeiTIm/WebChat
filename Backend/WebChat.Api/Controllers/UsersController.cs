using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using WebChat.Api.DTOs.Users;
using WebChat.Api.Services.Users;

namespace WebChat.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/users")]
public sealed class UsersController : ControllerBase
{
    private readonly IUserService _userService;

    public UsersController(IUserService userService)
    {
        _userService = userService;
    }

    // =====================================================
    // GET MY PROFILE
    // =====================================================

    [HttpGet("me")]
    public async Task<ActionResult<UserProfileResponse>> GetMe(
        CancellationToken cancellationToken)
    {
        if (!TryGetUserId(out var userId))
        {
            return Unauthorized();
        }

        var profile = await _userService.GetMyProfileAsync(
            userId,
            cancellationToken);

        if (profile is null)
        {
            return NotFound(new
            {
                success = false,
                message = "Không tìm thấy tài khoản."
            });
        }

        return Ok(profile);
    }

    // =====================================================
    // UPDATE MY PROFILE
    // =====================================================

    [HttpPut("me")]
    public async Task<ActionResult<UserProfileResponse>> UpdateMe(
        [FromBody] UpdateUserProfileRequest request,
        CancellationToken cancellationToken)
    {
        if (!TryGetUserId(out var userId))
        {
            return Unauthorized();
        }

        try
        {
            var profile = await _userService.UpdateMyProfileAsync(
                userId,
                request,
                cancellationToken);

            if (profile is null)
            {
                return NotFound(new
                {
                    success = false,
                    message = "Không tìm thấy tài khoản."
                });
            }

            return Ok(profile);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new
            {
                success = false,
                message = ex.Message
            });
        }
    }

    // =====================================================
    // USER DISCOVERY + SEARCH
    //
    // GET /api/users/search?page=1&pageSize=20
    // GET /api/users/search?q=ngan&page=1&pageSize=20
    // GET /api/users/search?q=t&page=1&pageSize=20
    //
    // q empty: show other active users
    // q present: filter by username/display name
    // =====================================================

    [HttpGet("search")]
    public async Task<ActionResult<UserSearchResponse>> Search(
        [FromQuery] string? q = null,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20,
        CancellationToken cancellationToken = default)
    {
        if (!TryGetUserId(out var userId))
        {
            return Unauthorized();
        }

        try
        {
            var result = await _userService.SearchUsersAsync(
                userId,
                q ?? string.Empty,
                page,
                pageSize,
                cancellationToken);

            return Ok(result);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new
            {
                success = false,
                message = ex.Message
            });
        }
    }

    // =====================================================
    // JWT USER ID
    // =====================================================

    private bool TryGetUserId(out Guid userId)
    {
        var idText = User.FindFirstValue(
            ClaimTypes.NameIdentifier);

        return Guid.TryParse(idText, out userId);
    }
}