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

    // Tin nhắn cuối cùng thành viên đã đọc.
    public long LastReadSequence { get; set; } = 0;

    public DateTime? LastReadAtUtc { get; set; }

    public bool IsArchived { get; set; } = false;

    public bool IsMuted { get; set; } = false;

    // Navigation
    public Conversation Conversation { get; set; } = null!;
}