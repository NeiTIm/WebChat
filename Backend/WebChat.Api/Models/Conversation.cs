using System;
using System.Collections.Generic;

namespace WebChat.Api.Models;

public sealed class Conversation
{
    public Guid Id { get; set; } = Guid.NewGuid();

    // 1 = Private, 2 = Group (dự phòng)
    public byte Type { get; set; } = 1;

    // Chỉ sử dụng cho Private Conversation
    public Guid? PrivateUserLowId { get; set; }

    public Guid? PrivateUserHighId { get; set; }

    public Guid CreatedByUserId { get; set; }

    public DateTime CreatedAtUtc { get; set; } =
        DateTime.UtcNow;

    public DateTime? LastMessageAtUtc { get; set; }

    public DateTime? UpdatedAtUtc { get; set; }

    // Số thứ tự cuối cùng đã cấp cho tin nhắn.
    public long LastMessageSequence { get; set; } = 0;

    // Navigation
    public ICollection<ConversationMember> Members
    {
        get;
        set;
    } = new List<ConversationMember>();

    public ICollection<Message> Messages
    {
        get;
        set;
    } = new List<Message>();
}