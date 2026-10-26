
using WebChat.Api.DTOs.Messages;

namespace WebChat.Api.Services.Messages;

public interface IMessageService
{
    // =====================================================
    // SEND TEXT MESSAGE
    // =====================================================

    Task<MessageDto> SendTextAsync(
        Guid conversationId,
        Guid currentUserId,
        SendMessageRequest request,
        CancellationToken cancellationToken = default
    );

    // =====================================================
    // GET MESSAGE HISTORY
    // =====================================================

    Task<MessageListResponse> GetMessagesAsync(
        Guid conversationId,
        Guid currentUserId,
        long? beforeSequence,
        int pageSize,
        CancellationToken cancellationToken = default
    );
}
