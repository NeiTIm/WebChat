namespace WebChat.Api.Models;

public sealed class Friendship
{
    public Guid Id { get; set; }

    public Guid UserAId { get; set; }

    public Guid UserBId { get; set; }

    public DateTime CreatedAtUtc { get; set; }
}