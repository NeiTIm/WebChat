namespace WebChat.Api.Models;

public sealed class FriendAuditLog
{
    public Guid Id { get; set; }

    public Guid ActorUserId { get; set; }

    public Guid TargetUserId { get; set; }

    public string EventType { get; set; } = string.Empty;

    public Guid? EntityId { get; set; }

    public DateTime OccurredAtUtc { get; set; }

    public string? MetadataJson { get; set; }
}