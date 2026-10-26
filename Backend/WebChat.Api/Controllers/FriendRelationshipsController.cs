
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
public sealed class FriendRelationshipsController : ControllerBase
{
    private readonly IFriendRelationshipService _service;

    private readonly IChatRealtimePublisher _realtimePublisher;

    private readonly ILogger<FriendRelationshipsController> _logger;

    public FriendRelationshipsController(
        IFriendRelationshipService service,
        IChatRealtimePublisher realtimePublisher,
        ILogger<FriendRelationshipsController> logger)
    {
        _service = service;
        _realtimePublisher = realtimePublisher;
        _logger = logger;
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
        {
            return Unauthorized();
        }

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
        {
            return Unauthorized();
        }

        try
        {
            // Service tự xử lý PairLock, transaction,
            // Remove Friendship và Audit Log.
            await _service.RemoveFriendAsync(
                currentUserId,
                userId,
                ct);

            // Chỉ phát khi transaction thành công.
            await PublishFriendshipChangedSafelyAsync(
                currentUserId,
                userId,
                "removed");

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
        {
            return Unauthorized();
        }

        try
        {
            // Service hiện tại xử lý:
            // - Tạo UserBlock
            // - Xóa Friendship nếu có
            // - Hủy Pending Requests của cả hai chiều
            // - Lưu Audit Logs
            // - Commit cùng một transaction
            await _service.BlockUserAsync(
                currentUserId,
                userId,
                ct);

            // Một event relationshipChanged là đủ
            // để Frontend refresh các trạng thái liên quan.
            //
            // Publisher gửi action "blocked" cho actor,
            // nhưng chỉ gửi "changed" cho target.
            //
            // Nếu đã có Conversation, Publisher cũng
            // phát ConversationPermissionChanged.
            await PublishFriendshipChangedSafelyAsync(
                currentUserId,
                userId,
                "blocked");

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
        {
            return Unauthorized();
        }

        try
        {
            await _service.UnblockUserAsync(
                currentUserId,
                userId,
                ct);

            // Không tự động tạo lại Friendship.
            // Chỉ thông báo quan hệ chặn đã thay đổi.
            await PublishFriendshipChangedSafelyAsync(
                currentUserId,
                userId,
                "unblocked");

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
        {
            return Unauthorized();
        }

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
    // 5.7.8A - SAFE FRIENDSHIP REALTIME PUBLISH
    // =====================================================

    private async Task PublishFriendshipChangedSafelyAsync(
        Guid actorUserId,
        Guid targetUserId,
        string action)
    {
        try
        {
            // Không truyền HTTP CancellationToken sau commit.
            // Client đóng request không được làm mất
            // bước publish đang thực hiện.
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
            // Thao tác lưu SQL đã hoàn thành.
            // Không trả HTTP 500 chỉ vì SignalR lỗi.
            _logger.LogWarning(
                ex,
                "Friend relationship saved, " +
                "but realtime publish failed. " +
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
