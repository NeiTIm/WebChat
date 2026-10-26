using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using WebChat.Api.DTOs.Friends;
using WebChat.Api.Services.Friends;

namespace WebChat.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/friends/statuses")]
public sealed class FriendStatusesController : ControllerBase
{
    private readonly IFriendStatusService _service;

    public FriendStatusesController(
        IFriendStatusService service)
    {
        _service = service;
    }

    // POST /api/friends/statuses
    // Body: { "userIds": ["guid1", "guid2"] }

    [HttpPost]
    public async Task<ActionResult<FriendStatusesResponse>> GetStatuses(
        [FromBody] FriendStatusesRequest? request,
        CancellationToken ct)
    {
        var userIdText = User.FindFirstValue(
            ClaimTypes.NameIdentifier);

        if (!Guid.TryParse(userIdText, out var currentUserId))
        {
            return Unauthorized();
        }

        if (request?.UserIds is null)
        {
            return BadRequest(new
            {
                success = false,
                message = "Danh sách UserIds là bắt buộc."
            });
        }

        try
        {
            var result = await _service.GetStatusesAsync(
                currentUserId,
                request.UserIds,
                ct);

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
}