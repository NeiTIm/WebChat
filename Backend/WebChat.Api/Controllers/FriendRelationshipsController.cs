using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using WebChat.Api.DTOs.Friends;
using WebChat.Api.Services.Friends;

namespace WebChat.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/friends")]
public sealed class FriendRelationshipsController : ControllerBase
{
    private readonly IFriendRelationshipService _service;

    public FriendRelationshipsController(
        IFriendRelationshipService service)
    {
        _service = service;
    }

    // =====================================================
    // GET /api/friends
    // =====================================================

    [HttpGet]
    public async Task<ActionResult<FriendUserListResponse>>
        GetFriends(
            [FromQuery] int page = 1,
            [FromQuery] int pageSize = 20,
            CancellationToken ct = default)
    {
        if (!TryGetUserId(out var userId))
            return Unauthorized();

        try
        {
            var result = await _service.GetFriendsAsync(
                userId,
                page,
                pageSize,
                ct);

            return Ok(result);
        }
        catch (FriendRequestException ex)
        {
            return BusinessError(ex);
        }
    }

    // =====================================================
    // DELETE /api/friends/{userId}
    // =====================================================

    [HttpDelete("{userId:guid}")]
    public async Task<IActionResult> RemoveFriend(
        Guid userId,
        CancellationToken ct)
    {
        if (!TryGetUserId(out var currentUserId))
            return Unauthorized();

        try
        {
            await _service.RemoveFriendAsync(
                currentUserId,
                userId,
                ct);

            return NoContent();
        }
        catch (FriendRequestException ex)
        {
            return BusinessError(ex);
        }
    }

    // =====================================================
    // POST /api/friends/blocks/{userId}
    // =====================================================

    [HttpPost("blocks/{userId:guid}")]
    public async Task<IActionResult> BlockUser(
        Guid userId,
        CancellationToken ct)
    {
        if (!TryGetUserId(out var currentUserId))
            return Unauthorized();

        try
        {
            await _service.BlockUserAsync(
                currentUserId,
                userId,
                ct);

            return NoContent();
        }
        catch (FriendRequestException ex)
        {
            return BusinessError(ex);
        }
        catch (DbUpdateException ex)
            when (IsUniqueViolation(ex))
        {
            return Conflict(new
            {
                success = false,
                message = "Quan hệ chặn đã tồn tại."
            });
        }
    }

    // =====================================================
    // DELETE /api/friends/blocks/{userId}
    // =====================================================

    [HttpDelete("blocks/{userId:guid}")]
    public async Task<IActionResult> UnblockUser(
        Guid userId,
        CancellationToken ct)
    {
        if (!TryGetUserId(out var currentUserId))
            return Unauthorized();

        try
        {
            await _service.UnblockUserAsync(
                currentUserId,
                userId,
                ct);

            return NoContent();
        }
        catch (FriendRequestException ex)
        {
            return BusinessError(ex);
        }
    }

    // =====================================================
    // GET /api/friends/blocks
    // =====================================================

    [HttpGet("blocks")]
    public async Task<ActionResult<FriendUserListResponse>>
        GetBlockedUsers(
            [FromQuery] int page = 1,
            [FromQuery] int pageSize = 20,
            CancellationToken ct = default)
    {
        if (!TryGetUserId(out var currentUserId))
            return Unauthorized();

        try
        {
            var result = await _service.GetBlockedUsersAsync(
                currentUserId,
                page,
                pageSize,
                ct);

            return Ok(result);
        }
        catch (FriendRequestException ex)
        {
            return BusinessError(ex);
        }
    }

    // =====================================================
    // HELPERS
    // =====================================================

    private bool TryGetUserId(out Guid userId)
    {
        return Guid.TryParse(
            User.FindFirstValue(ClaimTypes.NameIdentifier),
            out userId);
    }

    private ObjectResult BusinessError(FriendRequestException ex)
    {
        return StatusCode(ex.StatusCode, new
        {
            success = false,
            message = ex.Message
        });
    }

    private static bool IsUniqueViolation(DbUpdateException ex)
    {
        return ex.InnerException is SqlException sql &&
               (sql.Number == 2601 || sql.Number == 2627);
    }
}