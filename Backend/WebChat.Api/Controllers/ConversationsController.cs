
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using WebChat.Api.DTOs.Conversations;
using WebChat.Api.Services.Conversations;

namespace WebChat.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/conversations")]
public sealed class ConversationsController(
    IConversationService conversationService
) : ControllerBase
{
    // =====================================================
    // CURRENT USER - JWT
    // =====================================================

    private Guid? GetCurrentUserId()
    {
        var value = User.FindFirstValue(
            ClaimTypes.NameIdentifier
        );

        return Guid.TryParse(value, out var userId)
            && userId != Guid.Empty
            ? userId
            : null;
    }

    // =====================================================
    // POST /api/conversations/private
    // OPEN OR CREATE PRIVATE CONVERSATION
    // =====================================================

    [HttpPost("private")]
    public async Task<ActionResult<ConversationDto>>
        OpenPrivate(
            [FromBody] OpenPrivateConversationRequest request,
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

        if (request.TargetUserId == Guid.Empty)
        {
            return BadRequest(new
            {
                message = "TargetUserId không hợp lệ."
            });
        }

        if (request.TargetUserId == currentUserId.Value)
        {
            return BadRequest(new
            {
                message = "Không thể tạo hội thoại với chính mình."
            });
        }

        try
        {
            var conversation =
                await conversationService.OpenPrivateAsync(
                    currentUserId.Value,
                    request.TargetUserId,
                    cancellationToken);

            return Ok(conversation);
        }
        catch (ArgumentException)
        {
            return BadRequest(new
            {
                message = "Thông tin người dùng không hợp lệ."
            });
        }
        catch (InvalidOperationException ex)
            when (ex.Message ==
                "Một trong hai tài khoản không khả dụng.")
        {
            return NotFound(new
            {
                message = "Người dùng không khả dụng."
            });
        }
        catch (InvalidOperationException ex)
            when (ex.Message ==
                "Chỉ bạn bè không bị chặn mới " +
                "được bắt đầu cuộc trò chuyện.")
        {
            return StatusCode(
                StatusCodes.Status403Forbidden,
                new
                {
                    message =
                        "Bạn không có quyền bắt đầu " +
                        "cuộc trò chuyện này."
                });
        }
        catch (InvalidOperationException ex)
            when (ex.Message ==
                "Dữ liệu thành viên hội thoại không hợp lệ.")
        {
            return Conflict(new
            {
                message =
                    "Dữ liệu hội thoại không nhất quán. " +
                    "Không thể mở cuộc trò chuyện."
            });
        }
    }

    // =====================================================
    // GET /api/conversations?page=1&pageSize=20
    // MY PRIVATE CONVERSATIONS
    // =====================================================

    [HttpGet]
    public async Task<ActionResult<ConversationListResponse>>
        GetMyConversations(
            [FromQuery] int page = 1,
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

        if (page < 1)
        {
            return BadRequest(new
            {
                message = "Page phải lớn hơn hoặc bằng 1."
            });
        }

        if (pageSize < 1 || pageSize > 50)
        {
            return BadRequest(new
            {
                message = "PageSize phải nằm trong khoảng 1 đến 50."
            });
        }

        var result =
            await conversationService.GetMyConversationsAsync(
                currentUserId.Value,
                page,
                pageSize,
                cancellationToken);

        return Ok(result);
    }

    // =====================================================
    // GET /api/conversations/{id}
    // PRIVATE CONVERSATION DETAILS
    // =====================================================

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<ConversationDto>>
        GetById(
            Guid id,
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

        if (id == Guid.Empty)
        {
            return BadRequest(new
            {
                message = "ConversationId không hợp lệ."
            });
        }

        var conversation =
            await conversationService.GetByIdAsync(
                id,
                currentUserId.Value,
                cancellationToken);

        if (conversation is null)
        {
            // Cùng một phản hồi cho:
            // - Conversation không tồn tại
            // - Người dùng không thuộc Conversation
            return NotFound(new
            {
                message =
                    "Không tìm thấy hội thoại hoặc " +
                    "bạn không có quyền truy cập."
            });
        }

        return Ok(conversation);
    }
}
