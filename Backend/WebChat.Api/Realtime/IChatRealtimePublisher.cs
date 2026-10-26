
using WebChat.Api.DTOs.Messages;

namespace WebChat.Api.Realtime;

public interface IChatRealtimePublisher
{
    // =====================================================
    // 5.7 - MESSAGE REALTIME
    // =====================================================

    Task PublishMessageCreatedAsync(
        MessageDto message,
        CancellationToken cancellationToken = default);

    Task PublishConversationPermissionChangedAsync(
        Guid conversationId,
        CancellationToken cancellationToken = default);

    // =====================================================
    // 5.7.8A - FRIEND REQUEST REALTIME
    // =====================================================

    // action: sent, accepted, rejected, cancelled
    Task PublishFriendRequestChangedAsync(
        Guid senderUserId,
        Guid receiverUserId,
        Guid requestId,
        string action,
        CancellationToken cancellationToken = default);

    // =====================================================
    // 5.7.8A - FRIENDSHIP REALTIME
    // =====================================================

    // action: created, removed, blocked, unblocked
    Task PublishFriendshipChangedAsync(
        Guid actorUserId,
        Guid targetUserId,
        string action,
        CancellationToken cancellationToken = default);

    // =====================================================
    // 5.8C - MESSAGE READ REALTIME
    // =====================================================

    Task PublishMessageReadUpdatedAsync(
        MarkAsReadResponse result,
        Guid readerUserId,
        CancellationToken cancellationToken = default);

    // =====================================================
    // 5.8D3 - MESSAGE DELIVERED REALTIME
    // =====================================================

    Task PublishMessageDeliveredUpdatedAsync(
        MarkAsDeliveredResponse result,
        Guid recipientUserId,
        CancellationToken cancellationToken = default);
}
