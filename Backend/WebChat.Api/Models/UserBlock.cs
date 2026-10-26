namespace WebChat.Api.Models;

public sealed class UserBlock
{
    public Guid Id { get; set; }

    public Guid BlockerId { get; set; }

    public Guid BlockedId { get; set; }

    public DateTime CreatedAtUtc { get; set; }
}