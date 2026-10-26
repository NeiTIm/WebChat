
namespace WebChat.Api.DTOs.Messages;

public sealed class MarkAsReadRequest
{
    public long LastReadSequence { get; set; }
}
