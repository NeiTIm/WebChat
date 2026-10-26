using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Data.SqlClient;
using WebChat.Api.DTOs.Friends;
using WebChat.Api.Services.Friends;

namespace WebChat.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/friends")]
public sealed class FriendsController : ControllerBase
{
    private readonly IFriendRequestService _service;

    public FriendsController(IFriendRequestService service)
    {
        _service = service;
    }

    // =====================================================
    // POST /api/friends/requests
    // =====================================================

    [HttpPost("requests")]
    public async Task<ActionResult<FriendRequestResponse>> Send(
        [FromBody] SendFriendRequestDto dto,
        CancellationToken ct)
    {
        if (!TryGetUserId(out var userId))
            return Unauthorized();

        try
        {
            var result = await _service.SendAsync(
                userId,
                dto.ReceiverId,
                ct);

            return StatusCode(201, result);
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
                message = "Lời mời hoặc quan hệ giữa hai người đã tồn tại."
            });
        }
    }

    // =====================================================
    // GET /api/friends/requests/received
    // =====================================================

    [HttpGet("requests/received")]
    public async Task<ActionResult<FriendRequestListResponse>> Received(
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20,
        CancellationToken ct = default)
    {
        if (!TryGetUserId(out var userId))
            return Unauthorized();

        try
        {
            var result = await _service.GetReceivedAsync(
                userId, page, pageSize, ct);

            return Ok(result);
        }
        catch (FriendRequestException ex)
        {
            return BusinessError(ex);
        }
    }

    // =====================================================
    // GET /api/friends/requests/sent
    // =====================================================

    [HttpGet("requests/sent")]
    public async Task<ActionResult<FriendRequestListResponse>> Sent(
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20,
        CancellationToken ct = default)
    {
        if (!TryGetUserId(out var userId))
            return Unauthorized();

        try
        {
            var result = await _service.GetSentAsync(
                userId, page, pageSize, ct);

            return Ok(result);
        }
        catch (FriendRequestException ex)
        {
            return BusinessError(ex);
        }
    }

    // =====================================================
    // POST /api/friends/requests/{id}/accept
    // =====================================================

    [HttpPost("requests/{id:guid}/accept")]
    public async Task<ActionResult<FriendRequestResponse>> Accept(
        Guid id,
        CancellationToken ct)
    {
        if (!TryGetUserId(out var userId))
            return Unauthorized();

        try
        {
            var result = await _service.AcceptAsync(
                id, userId, ct);

            return Ok(result);
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
                message = "Quan hệ bạn bè đã tồn tại."
            });
        }
    }

    // =====================================================
    // POST /api/friends/requests/{id}/reject
    // =====================================================

    [HttpPost("requests/{id:guid}/reject")]
    public async Task<ActionResult<FriendRequestResponse>> Reject(
        Guid id,
        CancellationToken ct)
    {
        if (!TryGetUserId(out var userId))
            return Unauthorized();

        try
        {
            var result = await _service.RejectAsync(
                id, userId, ct);

            return Ok(result);
        }
        catch (FriendRequestException ex)
        {
            return BusinessError(ex);
        }
    }

    // =====================================================
    // POST /api/friends/requests/{id}/cancel
    // =====================================================

    [HttpPost("requests/{id:guid}/cancel")]
    public async Task<ActionResult<FriendRequestResponse>> Cancel(
        Guid id,
        CancellationToken ct)
    {
        if (!TryGetUserId(out var userId))
            return Unauthorized();

        try
        {
            var result = await _service.CancelAsync(
                id, userId, ct);

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