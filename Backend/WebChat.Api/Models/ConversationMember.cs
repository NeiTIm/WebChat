
using System;

namespace WebChat.Api.Models;

public sealed class ConversationMember
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid ConversationId { get; set; }

    public Guid UserId { get; set; }

    public DateTime JoinedAtUtc { get; set; } =
        DateTime.UtcNow;

    // Dành cho Group Chat trong tương lai.
    public DateTime? LeftAtUtc { get; set; }

    // =====================================================
    // PHASE 5.8A - READ CURSOR
    // =====================================================

    // Tin nhắn cuối cùng thành viên đã đọc.
    public long LastReadSequence { get; set; } = 0;

    public DateTime? LastReadAtUtc { get; set; }

    // =====================================================
    // PHASE 5.8D1 - DELIVERY CURSOR
    // =====================================================

    // Vị trí cuối cùng thành viên xác nhận đã nhận
    // liên tục thông qua Delivered ACK.
    //
    // Cursor chỉ được tăng, không rollback.
    // Khi mới tạo membership, mặc định là 0.
    public long LastDeliveredSequence { get; set; } = 0;

    // Thời điểm Delivery Cursor tăng lần gần nhất.
    // Request trùng không cập nhật thời điểm này.
    public DateTime? LastDeliveredAtUtc { get; set; }

    // =====================================================
    // MEMBERSHIP SETTINGS
    // =====================================================

    public bool IsArchived { get; set; } = false;

    public bool IsMuted { get; set; } = false;

    // =====================================================
    // NAVIGATION
    // =====================================================

    public Conversation Conversation { get; set; } = null!;
}
