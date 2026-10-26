
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
    // SERVICES
    // =====================================================

    // Giữ nguyên Read Service đã có.
    private readonly MessageReadService _readService =
        new(db);

    // Dùng lại Delivery Service hiện có.
    // Không cần viết thêm Service mới.
    private readonly MessageDeliveryService _deliveryService =
        new(db);

    // =====================================================
    // CURRENT USER
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
        // 1. VALIDATE AUTHENTICATION
        // =================================================

        if (!currentUserId.HasValue)
        {
            return Unauthorized(new
            {
                message = "Phiên đăng nhập không hợp lệ."
            });
        }

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
            // 2. SAVE READ CURSOR
            // =================================================

            // Giữ nguyên nghiệp vụ cũ:
            // - Kiểm tra User Active
            // - Kiểm tra Conversation Membership
            // - Kiểm tra Sequence thực sự tồn tại
            // - Read Cursor chỉ tăng
            // - Không rollback khi request cũ hơn

            var readResult =
                await _readService.MarkAsReadAsync(
                    conversationId,
                    currentUserId.Value,
                    request.LastReadSequence,
                    cancellationToken);

            // =================================================
            // 3. ENSURE DELIVERED >= READ
            // =================================================

            // Logic mới của Phase 5.8E3:
            //
            // Nếu người dùng đã đọc đến sequence N,
            // thì thiết bị cũng đã nhận đến N.
            //
            // Delivery Service sẽ:
            // - Xác minh quyền
            // - Kiểm tra sequence
            // - Chỉ cập nhật nếu cursor tăng
            //
            // Không lấy online/presence làm ACK.
            //
            // Dùng LastReadSequence đã được DB
            // xác nhận thay vì giá trị client tự gửi.

            MarkAsDeliveredResponse? deliveryResult =
                null;

            try
            {
                using var deliveryTimeout =
                    new CancellationTokenSource(
                        TimeSpan.FromSeconds(15));

                deliveryResult =
                    await _deliveryService
                        .MarkAsDeliveredAsync(
                            conversationId,
                            currentUserId.Value,
                            readResult.LastReadSequence,
                            deliveryTimeout.Token);
            }
            catch (Exception ex)
            {
                // Read đã được ghi thành công.
                //
                // Không báo toàn bộ request thất bại
                // rồi khiến client Retry nhầm.
                //
                // Lần Read tiếp theo vẫn có thể
                // đồng bộ lại Delivered Cursor.

                logger.LogWarning(
                    ex,
                    "Read saved but Delivered sync failed. " +
                    "ConversationId={ConversationId}, " +
                    "UserId={UserId}, " +
                    "ReadSequence={Sequence}",
                    conversationId,
                    currentUserId.Value,
                    readResult.LastReadSequence);
            }

            // =================================================
            // 4. PUBLISH READ EVENT
            // =================================================

            // Chỉ phát sự kiện nếu Read Cursor tăng.
            //
            // Không ảnh hưởng dữ liệu SQL nếu
            // SignalR bị mất kết nối.

            if (readResult.Changed)
            {
                try
                {
                    using var realtimeTimeout =
                        new CancellationTokenSource(
                            TimeSpan.FromSeconds(15));

                    await realtimePublisher
                        .PublishMessageReadUpdatedAsync(
                            readResult,
                            currentUserId.Value,
                            realtimeTimeout.Token);
                }
                catch (Exception ex)
                {
                    logger.LogWarning(
                        ex,
                        "Read Cursor saved but SignalR " +
                        "MessageReadUpdated publish failed. " +
                        "ConversationId={ConversationId}, " +
                        "ReaderUserId={ReaderUserId}, " +
                        "Sequence={Sequence}",
                        conversationId,
                        currentUserId.Value,
                        readResult.LastReadSequence);
                }
            }

            // =================================================
            // 5. PUBLISH DELIVERED EVENT
            // =================================================

            // Nếu Delivered Cursor tăng nhờ Read,
            // thông báo realtime cho người gửi.
            //
            // Người gửi không cần F5 để nhận
            // cursor mới nếu SignalR hoạt động.

            if (deliveryResult?.Changed == true)
            {
                try
                {
                    using var realtimeTimeout =
                        new CancellationTokenSource(
                            TimeSpan.FromSeconds(15));

                    await realtimePublisher
                        .PublishMessageDeliveredUpdatedAsync(
                            deliveryResult,
                            currentUserId.Value,
                            realtimeTimeout.Token);
                }
                catch (Exception ex)
                {
                    logger.LogWarning(
                        ex,
                        "Delivered Cursor saved after Read " +
                        "but SignalR publish failed. " +
                        "ConversationId={ConversationId}, " +
                        "RecipientUserId={RecipientUserId}, " +
                        "Sequence={Sequence}",
                        conversationId,
                        currentUserId.Value,
                        deliveryResult.LastDeliveredSequence);
                }
            }

            // =================================================
            // 6. RETURN ORIGINAL READ RESPONSE
            // =================================================

            // Giữ nguyên response contract để
            // Frontend MessageReadSync không phải sửa.

            return Ok(readResult);
        }

        // =====================================================
        // 7. ERROR HANDLING
        // =====================================================

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
                message =
                    "Dữ liệu hội thoại không hợp lệ."
            });
        }
    }
}
