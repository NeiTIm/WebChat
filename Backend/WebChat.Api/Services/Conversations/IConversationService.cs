
using WebChat.Api.DTOs.Conversations;

namespace WebChat.Api.Services.Conversations;

public interface IConversationService
{
    // Mở Conversation đã tồn tại hoặc tạo mới
    // khi hai người đang là bạn bè.
    Task<ConversationDto> OpenPrivateAsync(
        Guid currentUserId,
        Guid targetUserId,
        CancellationToken cancellationToken = default
    );

    // Lấy chi tiết Conversation.
    // Chỉ thành viên của hội thoại được phép xem.
    Task<ConversationDto?> GetByIdAsync(
        Guid conversationId,
        Guid currentUserId,
        CancellationToken cancellationToken = default
    );

    // Lấy danh sách hội thoại của người dùng.
    // Phân trang tại Backend, không tải toàn bộ.
    Task<ConversationListResponse> GetMyConversationsAsync(
        Guid currentUserId,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default
    );
}

public sealed class ConversationListResponse
{
    public List<ConversationDto> Items { get; set; } = [];

    public int Page { get; set; }

    public int PageSize { get; set; }

    public int Total { get; set; }

    public int TotalPages { get; set; }

    public bool HasPreviousPage => Page > 1;

    public bool HasNextPage => Page < TotalPages;
}
