
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
[Route("api/conversations/{conversationId:guid}/read")]
public sealed class MessageReadController(
    AppDbContext db,
    IChatRealtimePublisher realtimePublisher,
    ILogger<MessageReadController> logger
) : ControllerBase
{
    // =====================================================
    // PHASE 5.8A - MESSAGE READ SERVICE
    // =====================================================

    // Giữ service đọc tin nhắn của Phase 5.8A.
    // Không thay đổi nghiệp vụ Read Cursor.
    private readonly MessageReadService _readService =
        new(db);

    // =====================================================
    // CURRENT USER FROM VALIDATED JWT
    // =====================================================

    private Guid? GetCurrentUserId()
    {
        var rawUserId = User.FindFirstValue(
            ClaimTypes.NameIdentifier);

        return Guid.TryParse(
                rawUserId,
                out var userId) &&
            userId != Guid.Empty
                ? userId
                : null;
    }

    // =====================================================
    // POST /api/conversations/{id}/read
    // =====================================================

    [HttpPost]
    public async Task<ActionResult<MarkAsReadResponse>>
        MarkAsRead(
            [FromRoute] Guid conversationId,
            [FromBody] MarkAsReadRequest request,
            CancellationToken cancellationToken)
    {
        var currentUserId = GetCurrentUserId();

        // =================================================
        // 1. VALIDATE JWT USER ID
        // =================================================

        if (!currentUserId.HasValue)
        {
            return Unauthorized(new
            {
                message = "Phiên đăng nhập không hợp lệ."
            });
        }

        // =================================================
        // 2. VALIDATE CONVERSATION ID
        // =================================================

        if (conversationId == Guid.Empty)
        {
            return BadRequest(new
            {
                message = "ConversationId không hợp lệ."
            });
        }

        // =================================================
        // 3. VALIDATE REQUEST
        // =================================================

        if (request is null)
        {
            return BadRequest(new
            {
                message = "Dữ liệu Mark as Read không hợp lệ."
            });
        }

        if (request.LastReadSequence <= 0)
        {
            return BadRequest(new
            {
                message =
                    "LastReadSequence phải lớn hơn 0."
            });
        }

        try
        {
            // =================================================
            // 4. UPDATE READ CURSOR - PHASE 5.8A
            // =================================================

            // MessageReadService xử lý:
            // - Kiểm tra tài khoản active
            // - Kiểm tra Private Conversation
            // - Kiểm tra Conversation Membership
            // - Kiểm tra Sequence tồn tại
            // - Atomic Conditional Update
            // - Read Cursor chỉ tăng, không rollback
            // - Request trùng không cập nhật timestamp
            //
            // Service trả về sau khi SQL update hoàn tất.

            var result =
                await _readService.MarkAsReadAsync(
                    conversationId,
                    currentUserId.Value,
                    request.LastReadSequence,
                    cancellationToken);

            // =================================================
            // 5. PUBLISH SIGNALR - PHASE 5.8C
            // =================================================

            // Chỉ publish khi cursor thực sự tăng.
            // changed=false không tạo Seen event.
            //
            // Không lấy ReaderUserId từ client.
            // ReaderUserId được lấy từ JWT.
            //
            // Publisher sẽ kiểm tra lại:
            // - Conversation Membership
            // - Read Cursor hiện tại
            // - User Active
            // - Friendship
            // - Block
            //
            // Sự kiện được phát sau DB update,
            // không tác động transaction Mark as Read.

            if (result.Changed)
            {
                try
                {
                    // Cancellation token độc lập với HTTP.
                    // Nếu client ngắt request sau khi SQL
                    // đã ghi thành công, vẫn thử phát event.
                    //
                    // Timeout để tránh giữ request quá lâu.
                    using var realtimeTimeout =
                        new CancellationTokenSource(
                            TimeSpan.FromSeconds(15));

                    await realtimePublisher
                        .PublishMessageReadUpdatedAsync(
                            result,
                            currentUserId.Value,
                            realtimeTimeout.Token);
                }
                catch (Exception ex)
                {
                    // =================================================
                    // 6. REALTIME BEST-EFFORT
                    // =================================================

                    // Database đã được cập nhật thành công.
                    // Không trả lỗi 500 hoặc rollback cursor
                    // chỉ vì SignalR publish thất bại.

                    logger.LogWarning(
                        ex,
                        "Read Cursor saved but SignalR " +
                        "MessageReadUpdated publish failed. " +
                        "ConversationId={ConversationId}, " +
                        "ReaderUserId={ReaderUserId}, " +
                        "LastReadSequence={Sequence}",
                        conversationId,
                        currentUserId.Value,
                        result.LastReadSequence);
                }
            }

            // =================================================
            // 7. RETURN AUTHORITATIVE RESULT
            // =================================================

            return Ok(result);
        }

        // =================================================
        // 8. ERROR HANDLING - PHASE 5.8A
        // =================================================

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
        catch (MarkAsReadConflictException ex)
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
                "Invalid Read Cursor state. " +
                "ConversationId={ConversationId}",
                conversationId);

            return Conflict(new
            {
                message = "Dữ liệu hội thoại không hợp lệ."
            });
        }
    }
}
