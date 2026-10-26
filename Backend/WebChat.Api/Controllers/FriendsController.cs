
using System.Security.Claims;

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

using WebChat.Api.DTOs.Friends;
using WebChat.Api.Realtime;
using WebChat.Api.Services.Friends;

namespace WebChat.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/friends")]
public sealed class FriendsController : ControllerBase
{
    private readonly IFriendRequestService _service;

    private readonly IChatRealtimePublisher _realtimePublisher;

    private readonly ILogger<FriendsController> _logger;

    public FriendsController(
        IFriendRequestService service,
        IChatRealtimePublisher realtimePublisher,
        ILogger<FriendsController> logger)
    {
        _service = service;
        _realtimePublisher = realtimePublisher;
        _logger = logger;
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
        {
            return Unauthorized();
        }

        try
        {
            var result = await _service.SendAsync(
                userId,
                dto.ReceiverId,
                ct);

            // Service đã commit thành công.
            await PublishRequestChangedSafelyAsync(
                result,
                "sent");

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
                message =
                    "Lời mời hoặc quan hệ giữa hai người đã tồn tại."
            });
        }
    }

    // =====================================================
    // GET /api/friends/requests/received
    // =====================================================

    [HttpGet("requests/received")]
    public async Task<ActionResult<FriendRequestListResponse>>
        Received(
            [FromQuery] int page = 1,
            [FromQuery] int pageSize = 20,
            CancellationToken ct = default)
    {
        if (!TryGetUserId(out var userId))
        {
            return Unauthorized();
        }

        try
        {
            var result = await _service.GetReceivedAsync(
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
    // GET /api/friends/requests/sent
    // =====================================================

    [HttpGet("requests/sent")]
    public async Task<ActionResult<FriendRequestListResponse>>
        Sent(
            [FromQuery] int page = 1,
            [FromQuery] int pageSize = 20,
            CancellationToken ct = default)
    {
        if (!TryGetUserId(out var userId))
        {
            return Unauthorized();
        }

        try
        {
            var result = await _service.GetSentAsync(
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
    // POST /api/friends/requests/{id}/accept
    // =====================================================

    [HttpPost("requests/{id:guid}/accept")]
    public async Task<ActionResult<FriendRequestResponse>>
        Accept(
            Guid id,
            CancellationToken ct)
    {
        if (!TryGetUserId(out var userId))
        {
            return Unauthorized();
        }

        try
        {
            var result = await _service.AcceptAsync(
                id,
                userId,
                ct);

            // 1. Lời mời đã được xử lý.
            await PublishRequestChangedSafelyAsync(
                result,
                "accepted");

            // 2. Quan hệ bạn bè mới được tạo.
            // Đồng thời yêu cầu cập nhật quyền hội thoại cũ,
            // nếu cặp User đã từng có Conversation.
            await PublishFriendshipChangedSafelyAsync(
                userId,
                result.SenderId,
                "created");

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
    public async Task<ActionResult<FriendRequestResponse>>
        Reject(
            Guid id,
            CancellationToken ct)
    {
        if (!TryGetUserId(out var userId))
        {
            return Unauthorized();
        }

        try
        {
            var result = await _service.RejectAsync(
                id,
                userId,
                ct);

            await PublishRequestChangedSafelyAsync(
                result,
                "rejected");

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
    public async Task<ActionResult<FriendRequestResponse>>
        Cancel(
            Guid id,
            CancellationToken ct)
    {
        if (!TryGetUserId(out var userId))
        {
            return Unauthorized();
        }

        try
        {
            var result = await _service.CancelAsync(
                id,
                userId,
                ct);

            await PublishRequestChangedSafelyAsync(
                result,
                "cancelled");

            return Ok(result);
        }
        catch (FriendRequestException ex)
        {
            return BusinessError(ex);
        }
    }

    // =====================================================
    // 5.7.8A - SAFE REQUEST REALTIME PUBLISH
    // =====================================================

    private async Task PublishRequestChangedSafelyAsync(
        FriendRequestResponse result,
        string action)
    {
        try
        {
            // Không phụ thuộc vào request CancellationToken:
            // SQL đã commit trước khi đi đến đây.
            using var timeout =
                new CancellationTokenSource(
                    TimeSpan.FromSeconds(5));

            await _realtimePublisher
                .PublishFriendRequestChangedAsync(
                    result.SenderId,
                    result.ReceiverId,
                    result.Id,
                    action,
                    timeout.Token);
        }
        catch (Exception ex)
        {
            // Realtime lỗi không được biến thao tác
            // đã commit thành HTTP 500.
            _logger.LogWarning(
                ex,
                "FriendRequest saved, but realtime " +
                "publish failed. " +
                "Action={Action}, RequestId={RequestId}",
                action,
                result.Id);
        }
    }

    // =====================================================
    // 5.7.8A - SAFE FRIENDSHIP REALTIME PUBLISH
    // =====================================================

    private async Task PublishFriendshipChangedSafelyAsync(
        Guid actorUserId,
        Guid targetUserId,
        string action)
    {
        try
        {
            using var timeout =
                new CancellationTokenSource(
                    TimeSpan.FromSeconds(5));

            await _realtimePublisher
                .PublishFriendshipChangedAsync(
                    actorUserId,
                    targetUserId,
                    action,
                    timeout.Token);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(
                ex,
                "Friendship saved, but realtime " +
                "publish failed. " +
                "Action={Action}, Actor={Actor}, Target={Target}",
                action,
                actorUserId,
                targetUserId);
        }
    }

    // =====================================================
    // HELPERS
    // =====================================================

    private bool TryGetUserId(out Guid userId)
    {
        return Guid.TryParse(
                   User.FindFirstValue(
                       ClaimTypes.NameIdentifier),
                   out userId)
               && userId != Guid.Empty;
    }

    private ObjectResult BusinessError(
        FriendRequestException ex)
    {
        return StatusCode(ex.StatusCode, new
        {
            success = false,
            message = ex.Message
        });
    }

    private static bool IsUniqueViolation(
        DbUpdateException ex)
    {
        return ex.InnerException is SqlException sql &&
               (sql.Number == 2601 ||
                sql.Number == 2627);
    }
}
