
using System.Security.Claims;

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

using WebChat.Api.Data;
using WebChat.Api.DTOs.Conversations;
using WebChat.Api.Services.Conversations;

namespace WebChat.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/conversations")]
public sealed class ConversationsController(
    IConversationService conversationService,
    AppDbContext db
) : ControllerBase
{
    // =====================================================
    // CURRENT USER - JWT
    // =====================================================

    private Guid? GetCurrentUserId()
    {
        var value = User.FindFirstValue(
            ClaimTypes.NameIdentifier);

        return Guid.TryParse(value, out var userId) &&
               userId != Guid.Empty
            ? userId
            : null;
    }

    // =====================================================
    // 5.8E1 - POPULATE READ / DELIVERED CURSORS
    // =====================================================

    // Chỉ dùng cho những ConversationDto đã được
    // ConversationService kiểm tra quyền truy cập.
    //
    // Không thay thế logic authorization của service.
    // Không ghi dữ liệu hoặc thay đổi Read Cursor.
    //
    // Dùng 1 batch query cho danh sách hội thoại.
    private async Task PopulateStatusCursorsAsync(
        Guid currentUserId,
        IReadOnlyCollection<ConversationDto> conversations,
        CancellationToken cancellationToken)
    {
        if (conversations.Count == 0)
        {
            return;
        }

        var ids = conversations
            .Select(x => x.Id)
            .Where(x => x != Guid.Empty)
            .Distinct()
            .ToArray();

        if (ids.Length == 0)
        {
            return;
        }

        var memberships = await db.ConversationMembers
            .AsNoTracking()
            .Where(m =>
                ids.Contains(m.ConversationId) &&
                m.LeftAtUtc == null)
            .Select(m => new
            {
                m.ConversationId,
                m.UserId,
                m.LastReadSequence,
                m.LastDeliveredSequence
            })
            .ToListAsync(cancellationToken);

        var byConversation = memberships
            .GroupBy(m => m.ConversationId)
            .ToDictionary(
                group => group.Key,
                group => group.ToList());

        foreach (var conversation in conversations)
        {
            if (
                !byConversation.TryGetValue(
                    conversation.Id,
                    out var members) ||
                members.Count != 2
            )
            {
                throw new InvalidOperationException(
                    "Dữ liệu thành viên hội thoại " +
                    "không nhất quán.");
            }

            var myMembership = members
                .SingleOrDefault(m =>
                    m.UserId == currentUserId);

            var otherMembership = members
                .SingleOrDefault(m =>
                    m.UserId == conversation.OtherUserId);

            if (
                myMembership is null ||
                otherMembership is null ||
                conversation.OtherUserId == Guid.Empty ||
                conversation.OtherUserId == currentUserId
            )
            {
                throw new InvalidOperationException(
                    "Dữ liệu thành viên hội thoại " +
                    "không nhất quán.");
            }

            // =============================================
            // READ CURSORS
            // =============================================

            conversation.MyLastReadSequence =
                myMembership.LastReadSequence;

            conversation.OtherLastReadSequence =
                otherMembership.LastReadSequence;

            // Đồng bộ trường cũ để các consumer cũ
            // vẫn nhận đúng Read Cursor của mình.
            conversation.LastReadSequence =
                myMembership.LastReadSequence;

            // =============================================
            // DELIVERED CURSORS
            // =============================================

            conversation.MyLastDeliveredSequence =
                myMembership.LastDeliveredSequence;

            conversation.OtherLastDeliveredSequence =
                otherMembership.LastDeliveredSequence;

            // Không sửa UnreadCount.
            // Giá trị đã được ConversationService
            // tính trong Phase 5.8B.
        }
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
                message =
                    "Không thể tạo hội thoại với chính mình."
            });
        }

        try
        {
            var conversation =
                await conversationService.OpenPrivateAsync(
                    currentUserId.Value,
                    request.TargetUserId,
                    cancellationToken);

            await PopulateStatusCursorsAsync(
                currentUserId.Value,
                new[] { conversation },
                cancellationToken);

            return Ok(conversation);
        }
        catch (ArgumentException)
        {
            return BadRequest(new
            {
                message =
                    "Thông tin người dùng không hợp lệ."
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

        await PopulateStatusCursorsAsync(
            currentUserId.Value,
            result.Items,
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
            return NotFound(new
            {
                message =
                    "Không tìm thấy hội thoại hoặc " +
                    "bạn không có quyền truy cập."
            });
        }

        await PopulateStatusCursorsAsync(
            currentUserId.Value,
            new[] { conversation },
            cancellationToken);

        return Ok(conversation);
    }
}
