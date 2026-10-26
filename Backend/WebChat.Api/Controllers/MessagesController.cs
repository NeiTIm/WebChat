
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

using WebChat.Api.DTOs.Messages;
using WebChat.Api.Realtime;
using WebChat.Api.Services.Messages;

namespace WebChat.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/conversations/{conversationId:guid}/messages")]
public sealed class MessagesController(
    IMessageService messageService,
    IChatRealtimePublisher realtimePublisher,
    ILogger<MessagesController> logger
) : ControllerBase
{
    // =====================================================
    // CURRENT USER FROM JWT
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
    // POST /api/conversations/{id}/messages
    // =====================================================

    [HttpPost]
    public async Task<ActionResult<MessageDto>> SendMessage(
        [FromRoute] Guid conversationId,
        [FromBody] SendMessageRequest request,
        CancellationToken cancellationToken)
    {
        var currentUserId = GetCurrentUserId();

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
                message = "Dữ liệu tin nhắn không hợp lệ."
            });
        }

        if (request.ClientMessageId == Guid.Empty)
        {
            return BadRequest(new
            {
                message = "ClientMessageId không hợp lệ."
            });
        }

        if (string.IsNullOrWhiteSpace(request.Content))
        {
            return BadRequest(new
            {
                message =
                    "Nội dung tin nhắn không được để trống."
            });
        }

        var normalizedContent = request.Content.Trim();

        if (normalizedContent.Length > 4000)
        {
            return BadRequest(new
            {
                message =
                    "Tin nhắn không được vượt quá 4000 ký tự."
            });
        }

        try
        {
            // =================================================
            // 1. SAVE USING EXISTING MESSAGE SERVICE
            // =================================================

            // MessageService xử lý:
            // - FriendPairLock
            // - Conversation MessageLock
            // - Friendship/Block
            // - ClientMessageId idempotency
            // - SequenceNumber
            // - SQL Transaction + Commit

            var result = await messageService.SendTextAsync(
                conversationId,
                currentUserId.Value,
                request,
                cancellationToken);

            // =================================================
            // 2. PUBLISH ONLY AFTER SUCCESSFUL COMMIT
            // =================================================

            // Service chỉ trả kết quả sau khi commit.
            // Nếu phát realtime lỗi thì vẫn trả 200,
            // vì tin nhắn đã được lưu thành công.
            //
            // Không để việc client ngắt HTTP request
            // ngay sau commit hủy thao tác phát sự kiện.

            try
            {
                using var realtimeTimeout =
                    new CancellationTokenSource(
                        TimeSpan.FromSeconds(5));

                await realtimePublisher
                    .PublishMessageCreatedAsync(
                        result,
                        realtimeTimeout.Token);
            }
            catch (Exception ex)
            {
                // SignalR là best-effort.
                // Không được coi SQL commit thành công
                // là gửi tin thất bại chỉ vì realtime lỗi.
                logger.LogWarning(
                    ex,
                    "Message saved but realtime publish " +
                    "failed. ConversationId={ConversationId}, " +
                    "MessageId={MessageId}",
                    result.ConversationId,
                    result.Id);
            }

            // 200 cho cả gửi mới và retry cùng ID.
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
        catch (UnauthorizedAccessException)
        {
            return StatusCode(
                StatusCodes.Status403Forbidden,
                new
                {
                    message =
                        "Bạn không có quyền gửi tin nhắn " +
                        "trong hội thoại này."
                });
        }
        catch (InvalidOperationException ex)
            when (ex.Message.StartsWith(
                "ClientMessageId đã được sử dụng",
                StringComparison.Ordinal))
        {
            return Conflict(new
            {
                message = ex.Message
            });
        }
        catch (InvalidOperationException ex)
        {
            return Conflict(new
            {
                message = ex.Message
            });
        }
    }

    // =====================================================
    // GET /api/conversations/{id}/messages
    // =====================================================

    [HttpGet]
    public async Task<ActionResult<MessageListResponse>>
        GetMessages(
            [FromRoute] Guid conversationId,
            [FromQuery] long? beforeSequence = null,
            [FromQuery] int pageSize = 20,
            CancellationToken cancellationToken = default)
    {
        var currentUserId = GetCurrentUserId();

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

        if (pageSize < 1 || pageSize > 50)
        {
            return BadRequest(new
            {
                message =
                    "pageSize phải nằm trong khoảng 1 đến 50."
            });
        }

        if (beforeSequence.HasValue &&
            beforeSequence.Value <= 0)
        {
            return BadRequest(new
            {
                message = "beforeSequence phải lớn hơn 0."
            });
        }

        try
        {
            var result =
                await messageService.GetMessagesAsync(
                    conversationId,
                    currentUserId.Value,
                    beforeSequence,
                    pageSize,
                    cancellationToken);

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
        catch (InvalidOperationException)
        {
            return Conflict(new
            {
                message = "Dữ liệu hội thoại không hợp lệ."
            });
        }
    }
}
