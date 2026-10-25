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

    // GET /api/users/me
    [HttpGet("me")]
    public async Task<ActionResult<UserProfileResponse>> GetMe(
        CancellationToken cancellationToken)
    {
        if (!TryGetUserId(out var userId))
        {
            return Unauthorized();
        }

        var profile = await _userService.GetMyProfileAsync(
            userId, cancellationToken);

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

    // PUT /api/users/me
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

    private bool TryGetUserId(out Guid userId)
    {
        var idText = User.FindFirstValue(
            ClaimTypes.NameIdentifier);

        return Guid.TryParse(idText, out userId);
    }
}