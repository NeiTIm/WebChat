
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

using WebChat.Api.Data;

namespace WebChat.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/delivery/cursors")]
public sealed class DeliveryCursorController(
    AppDbContext db
) : ControllerBase
{
    private const byte PrivateConversationType = 1;

    [HttpGet]
    public async Task<IActionResult> GetCursors(
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        CancellationToken cancellationToken = default)
    {
        if (page < 1 || pageSize is < 1 or > 50)
        {
            return BadRequest(new
            {
                message = "Pagination không hợp lệ."
            });
        }

        var userIdText = User.FindFirstValue(
            ClaimTypes.NameIdentifier);

        if (!Guid.TryParse(userIdText, out var userId) ||
            userId == Guid.Empty)
        {
            return Unauthorized();
        }

        var userActive = await db.Users
            .AsNoTracking()
            .AnyAsync(
                x => x.Id == userId && x.IsActive,
                cancellationToken);

        if (!userActive)
        {
            return Unauthorized();
        }

        var query = db.ConversationMembers
            .AsNoTracking()
            .Where(m =>
                m.UserId == userId &&
                m.LeftAtUtc == null &&
                m.Conversation.Type ==
                    PrivateConversationType &&
                (
                    m.Conversation.PrivateUserLowId == userId ||
                    m.Conversation.PrivateUserHighId == userId
                ));

        var total = await query.CountAsync(
            cancellationToken);

        var items = await query
            .OrderBy(m => m.ConversationId)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(m => new
            {
                m.ConversationId,
                m.Conversation.LastMessageSequence,
                MyLastDeliveredSequence =
                    m.LastDeliveredSequence,

                OtherLastDeliveredSequence =
                    db.ConversationMembers
                        .Where(other =>
                            other.ConversationId ==
                                m.ConversationId &&
                            other.UserId != userId &&
                            other.LeftAtUtc == null)
                        .Select(other =>
                            (long?)other.LastDeliveredSequence)
                        .FirstOrDefault()
            })
            .ToListAsync(cancellationToken);

        return Ok(new
        {
            Page = page,
            PageSize = pageSize,
            Total = total,
            TotalPages = (int)Math.Ceiling(
                total / (double)pageSize),
            Items = items
        });
    }
}
