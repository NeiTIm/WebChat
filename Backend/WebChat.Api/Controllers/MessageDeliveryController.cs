
using System.Security.Claims;

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

using WebChat.Api.Data;
using WebChat.Api.DTOs.Messages;
using WebChat.Api.Realtime;
using WebChat.Api.Services.Messages;

namespace WebChat.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/conversations/{conversationId:guid}/delivered")]
public sealed class MessageDeliveryController(
    AppDbContext db,
    IChatRealtimePublisher realtimePublisher,
    ILogger<MessageDeliveryController> logger
) : ControllerBase
{
    // =====================================================
    // 5.8D2 - DELIVERY SERVICE
    // =====================================================

    private readonly MessageDeliveryService _deliveryService =
        new(db);

    // =====================================================
    // CURRENT USER FROM VALIDATED JWT
    // =====================================================

    private Guid? GetCurrentUserId()
    {
        var rawUserId = User.FindFirstValue(
            ClaimTypes.NameIdentifier);

        return Guid.TryParse(rawUserId, out var userId) &&
               userId != Guid.Empty
            ? userId
            : null;
    }

    // =====================================================
    // POST /api/conversations/{id}/delivered
    // =====================================================

    [HttpPost]
    public async Task<ActionResult<MarkAsDeliveredResponse>>
        MarkAsDelivered(
            [FromRoute] Guid conversationId,
            [FromBody] MarkAsDeliveredRequest request,
            CancellationToken cancellationToken)
    {
        var currentUserId = GetCurrentUserId();

        // =================================================
        // 1. VALIDATE AUTHENTICATED USER
        // =================================================

        if (!currentUserId.HasValue)
        {
            return Unauthorized(new
            {
                message = "Phiên đăng nhập không hợp lệ."
            });
        }

        // =================================================
        // 2. VALIDATE REQUEST
        // =================================================

        if (conversationId == Guid.Empty)
        {
            return BadRequest(new
            {
                message = "ConversationId không hợp lệ."
            });
        }

        if (request is null)
        {
            return BadRequest(new
            {
                message =
                    "Dữ liệu Delivered ACK không hợp lệ."
            });
        }

        if (request.LastDeliveredSequence <= 0)
        {
            return BadRequest(new
            {
                message =
                    "LastDeliveredSequence phải lớn hơn 0."
            });
        }

        try
        {
            // =============================================
            // 3. PERSIST DELIVERY CURSOR - PHASE 5.8D2
            // =============================================

            var result = await _deliveryService
                .MarkAsDeliveredAsync(
                    conversationId,
                    currentUserId.Value,
                    request.LastDeliveredSequence,
                    cancellationToken);

            // =============================================
            // 4. PUBLISH SIGNALR - PHASE 5.8D3
            // =============================================

            // Chỉ phát khi cursor thực sự tăng.
            // Request trùng/cũ không phát event.
            //
            // Service hoàn thành database update trước.
            // SignalR thất bại không rollback SQL.

            if (result.Changed)
            {
                try
                {
                    // Không gắn với HTTP cancellation
                    // sau khi database đã lưu thành công.
                    using var realtimeTimeout =
                        new CancellationTokenSource(
                            TimeSpan.FromSeconds(15));

                    await realtimePublisher
                        .PublishMessageDeliveredUpdatedAsync(
                            result,
                            currentUserId.Value,
                            realtimeTimeout.Token);
                }
                catch (Exception ex)
                {
                    // Không làm thất bại REST request
                    // chỉ vì lỗi realtime.
                    logger.LogWarning(
                        ex,
                        "Delivery Cursor saved but " +
                        "MessageDeliveredUpdated publish failed. " +
                        "ConversationId={ConversationId}, " +
                        "RecipientUserId={RecipientUserId}, " +
                        "Sequence={Sequence}",
                        conversationId,
                        currentUserId.Value,
                        result.LastDeliveredSequence);
                }
            }

            // =============================================
            // 5. RETURN AUTHORITATIVE RESULT
            // =============================================

            return Ok(result);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new
            {
                message = ex.Message
            });
        }
        catch (KeyNotFoundException)
        {
            return NotFound(new
            {
                message =
                    "Không tìm thấy hội thoại hoặc " +
                    "bạn không có quyền truy cập."
            });
        }
        catch (MarkAsDeliveredConflictException ex)
        {
            return Conflict(new
            {
                message = ex.Message
            });
        }
        catch (InvalidOperationException ex)
        {
            logger.LogWarning(
                ex,
                "Invalid Delivered ACK state. " +
                "ConversationId={ConversationId}",
                conversationId);

            return Conflict(new
            {
                message =
                    "Dữ liệu hội thoại không hợp lệ."
            });
        }
    }
}
