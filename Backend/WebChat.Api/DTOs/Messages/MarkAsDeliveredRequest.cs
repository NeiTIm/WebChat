
namespace WebChat.Api.DTOs.Messages;

public sealed class MarkAsDeliveredRequest
{
    public long LastDeliveredSequence { get; set; }
}
