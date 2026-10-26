
using System.Security.Claims;

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using WebChat.Api.Data;

using WebChat.Api.DTOs.Messages;
using WebChat.Api.Realtime;
using WebChat.Api.Services.Conversations;
using WebChat.Api.Services.Messages;

namespace WebChat.Api.Hubs;

// =====================================================
// REQUEST DTOs
// =====================================================

public sealed class SendChatMessageRequest
{
    public Guid ConversationId { get; set; }
    public Guid ClientMessageId { get; set; }
    public string? Content { get; set; }
}

public sealed class ChatTypingRequest
{
    public Guid ConversationId { get; set; }
}

public sealed class WatchPresenceRequest
{
    public Guid ConversationId { get; set; }
}

public sealed class WatchFriendPresenceRequest
{
    public Guid UserId { get; set; }
}

// =====================================================
// CHAT HUB
// =====================================================

[Authorize]
public sealed class ChatHub(
    IMessageService messageService,
    IConversationService conversationService,
    IChatRealtimePublisher realtimePublisher,
    IPresenceService presenceService,
    AppDbContext db,
    ILogger<ChatHub> logger
) : Hub
{
    private Guid GetCurrentUserId()
    {
        var rawUserId = Context.User?
            .FindFirstValue(ClaimTypes.NameIdentifier);

        if (
            !Guid.TryParse(rawUserId, out var userId) ||
            userId == Guid.Empty
        )
        {
            throw new HubException(
                "Phiên đăng nhập không hợp lệ.");
        }

        return userId;
    }

    // =====================================================
    // CONNECT
    // =====================================================

    public override async Task OnConnectedAsync()
    {
        var userId = GetCurrentUserId();

        await presenceService.ConnectedAsync(
            userId,
            Context.ConnectionId);

        logger.LogInformation(
            "SignalR connected. User={UserId}, Connection={ConnectionId}",
            userId,
            Context.ConnectionId);

        await base.OnConnectedAsync();
    }

    // =====================================================
    // DISCONNECT
    // =====================================================

    public override async Task OnDisconnectedAsync(
        Exception? exception)
    {
        try
        {
            await presenceService.DisconnectedAsync(
                Context.ConnectionId);
        }
        catch (Exception ex)
        {
            logger.LogError(
                ex,
                "[Presence] Disconnect processing failed.");
        }

        logger.LogInformation(
            "SignalR disconnected. Connection={ConnectionId}",
            Context.ConnectionId);

        await base.OnDisconnectedAsync(exception);
    }

    // =====================================================
    // SEND MESSAGE (EXISTING)
    // =====================================================

    public async Task<MessageDto> SendMessage(
        SendChatMessageRequest request)
    {
        var currentUserId = GetCurrentUserId();

        if (request is null)
        {
            throw new HubException(
                "Dữ liệu tin nhắn không hợp lệ.");
        }

        if (request.ConversationId == Guid.Empty)
        {
            throw new HubException(
                "ConversationId không hợp lệ.");
        }

        if (request.ClientMessageId == Guid.Empty)
        {
            throw new HubException(
                "ClientMessageId không hợp lệ.");
        }

        var normalizedContent =
            request.Content?.Trim();

        if (string.IsNullOrWhiteSpace(normalizedContent))
        {
            throw new HubException(
                "Nội dung tin nhắn không được để trống.");
        }

        if (normalizedContent.Length > 4000)
        {
            throw new HubException(
                "Tin nhắn không được vượt quá 4000 ký tự.");
        }

        MessageDto savedMessage;

        try
        {
            savedMessage =
                await messageService.SendTextAsync(
                    request.ConversationId,
                    currentUserId,
                    new SendMessageRequest
                    {
                        ClientMessageId =
                            request.ClientMessageId,

                        Content =
                            normalizedContent
                    },
                    Context.ConnectionAborted);
        }
        catch (ArgumentException ex)
        {
            throw new HubException(ex.Message);
        }
        catch (KeyNotFoundException)
        {
            throw new HubException(
                "Không tìm thấy hội thoại hoặc " +
                "bạn không có quyền truy cập.");
        }
        catch (UnauthorizedAccessException)
        {
            throw new HubException(
                "Bạn không có quyền gửi tin nhắn " +
                "trong hội thoại này.");
        }
        catch (InvalidOperationException ex)
        {
            logger.LogInformation(
                "Message rejected. User={UserId}, Conversation={ConversationId}",
                currentUserId,
                request.ConversationId);

            throw new HubException(ex.Message);
        }

        try
        {
            using var publishTimeout =
                new CancellationTokenSource(
                    TimeSpan.FromSeconds(5));

            await realtimePublisher
                .PublishMessageCreatedAsync(
                    savedMessage,
                    publishTimeout.Token);
        }
        catch (Exception ex)
        {
            logger.LogWarning(
                ex,
                "Message saved but publish failed. MessageId={MessageId}",
                savedMessage.Id);
        }

        return savedMessage;
    }

    // =====================================================
    // AUTHORIZATION FOR PRIVATE CONVERSATION
    // =====================================================

    private async Task<Guid> GetAuthorizedOtherUserAsync(
        Guid conversationId)
    {
        var currentUserId = GetCurrentUserId();

        if (conversationId == Guid.Empty)
        {
            throw new HubException(
                "ConversationId không hợp lệ.");
        }

        var conversation =
            await conversationService.GetByIdAsync(
                conversationId,
                currentUserId,
                Context.ConnectionAborted);

        if (
            conversation is null ||
            !conversation.CanSendMessage ||
            conversation.Type != 1 ||
            conversation.OtherUserId == Guid.Empty ||
            conversation.OtherUserId == currentUserId
        )
        {
            throw new HubException(
                "Bạn không có quyền thực hiện thao tác " +
                "trong hội thoại này.");
        }

        return conversation.OtherUserId;
    }

    // =====================================================
    // START TYPING (EXISTING)
    // =====================================================

    public async Task StartTyping(
        ChatTypingRequest request)
    {
        if (request is null)
        {
            throw new HubException(
                "Dữ liệu Typing không hợp lệ.");
        }

        var currentUserId = GetCurrentUserId();

        var otherUserId =
            await GetAuthorizedOtherUserAsync(
                request.ConversationId);

        await Clients
            .User(otherUserId.ToString())
            .SendAsync(
                "TypingStarted",
                new
                {
                    conversationId = request.ConversationId,
                    userId = currentUserId,
                    connectionId = Context.ConnectionId
                },
                Context.ConnectionAborted);
    }

    // =====================================================
    // STOP TYPING (EXISTING)
    // =====================================================

    public async Task StopTyping(
        ChatTypingRequest request)
    {
        if (request is null)
        {
            throw new HubException(
                "Dữ liệu Typing không hợp lệ.");
        }

        var currentUserId = GetCurrentUserId();

        var otherUserId =
            await GetAuthorizedOtherUserAsync(
                request.ConversationId);

        await Clients
            .User(otherUserId.ToString())
            .SendAsync(
                "TypingStopped",
                new
                {
                    conversationId = request.ConversationId,
                    userId = currentUserId,
                    connectionId = Context.ConnectionId
                },
                Context.ConnectionAborted);
    }

    // =====================================================
    // 5.7.7 - WATCH PRESENCE
    // =====================================================

    public async Task<PresenceSnapshot> WatchPresence(
        WatchPresenceRequest request)
    {
        if (request is null)
        {
            throw new HubException(
                "Dữ liệu Presence không hợp lệ.");
        }

        var currentUserId = GetCurrentUserId();

        // Backend tự xác định người đối diện,
        // Client không được truyền TargetUserId.
        var otherUserId =
            await GetAuthorizedOtherUserAsync(
                request.ConversationId);

        // Sau khi quyền được xác thực,
        // đăng ký theo dõi trên connection này.
        return presenceService.Watch(
            currentUserId,
            Context.ConnectionId,
            otherUserId,
            request.ConversationId);
    }

    // =====================================================
    // 5.7.7 - UNWATCH PRESENCE
    // =====================================================

    public async Task UnwatchPresence(
        WatchPresenceRequest request)
    {
        if (request is null)
        {
            throw new HubException(
                "Dữ liệu Presence không hợp lệ.");
        }

        var currentUserId = GetCurrentUserId();

        var otherUserId =
            await GetAuthorizedOtherUserAsync(
                request.ConversationId);

        presenceService.UnwatchConversation(
            Context.ConnectionId,
            otherUserId);
    }

    // =====================================================
    // 5.7.7C - FRIEND PRESENCE WITHOUT A CONVERSATION
    // =====================================================

    private async Task EnsureFriendAccessAsync(Guid targetUserId)
    {
        var currentUserId = GetCurrentUserId();

        if (targetUserId == Guid.Empty || targetUserId == currentUserId)
        {
            throw new HubException("UserId không hợp lệ.");
        }

        var activeUsers = await db.Users.AsNoTracking().CountAsync(
            u => (u.Id == currentUserId || u.Id == targetUserId) && u.IsActive,
            Context.ConnectionAborted);

        if (activeUsers != 2)
        {
            throw new HubException("Không thể xem trạng thái người dùng.");
        }

        var friends = await db.Friendships.AsNoTracking().AnyAsync(
            f => (f.UserAId == currentUserId && f.UserBId == targetUserId) ||
                 (f.UserAId == targetUserId && f.UserBId == currentUserId),
            Context.ConnectionAborted);

        if (!friends)
        {
            throw new HubException("Chỉ được xem trạng thái của bạn bè.");
        }

        var blocked = await db.UserBlocks.AsNoTracking().AnyAsync(
            b => (b.BlockerId == currentUserId && b.BlockedId == targetUserId) ||
                 (b.BlockerId == targetUserId && b.BlockedId == currentUserId),
            Context.ConnectionAborted);

        if (blocked)
        {
            throw new HubException("Không được xem trạng thái khi có quan hệ chặn.");
        }
    }

    public async Task<PresenceSnapshot> WatchFriendPresence(
        WatchFriendPresenceRequest request)
    {
        if (request is null)
        {
            throw new HubException("Dữ liệu Presence không hợp lệ.");
        }

        await EnsureFriendAccessAsync(request.UserId);

        return presenceService.WatchFriend(
            GetCurrentUserId(), Context.ConnectionId, request.UserId);
    }

    public Task UnwatchFriendPresence(WatchFriendPresenceRequest request)
    {
        if (request is null || request.UserId == Guid.Empty)
        {
            throw new HubException("UserId không hợp lệ.");
        }

        // Chỉ huỷ đăng ký trên connection hiện tại.
        // Không yêu cầu hai người vẫn còn kết bạn để huỷ.
        presenceService.UnwatchFriend(Context.ConnectionId, request.UserId);
        return Task.CompletedTask;
    }

}
