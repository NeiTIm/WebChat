
using System.Security.Claims;
using Microsoft.AspNetCore.SignalR;

namespace WebChat.Api.Realtime;

public sealed class ChatUserIdProvider : IUserIdProvider
{
    public string? GetUserId(
        HubConnectionContext connection)
    {
        var rawUserId = connection.User?
            .FindFirstValue(
                ClaimTypes.NameIdentifier);

        if (!Guid.TryParse(
                rawUserId,
                out var userId) ||
            userId == Guid.Empty)
        {
            return null;
        }

        return userId.ToString("D");
    }
}
