
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

using WebChat.Api.Data;
using WebChat.Api.Hubs;
using WebChat.Api.Services.Conversations;

namespace WebChat.Api.Realtime;

// =====================================================
// PRESENCE DTO
// =====================================================

public sealed record PresenceSnapshot(
    Guid UserId,
    bool IsOnline
);

// =====================================================
// PRESENCE SERVICE CONTRACT
// =====================================================

public interface IPresenceService
{
    Task ConnectedAsync(
        Guid userId,
        string connectionId);

    Task DisconnectedAsync(
        string connectionId);

    PresenceSnapshot Watch(
        Guid currentUserId,
        string connectionId,
        Guid targetUserId,
        Guid conversationId);

    void UnwatchConversation(
        string connectionId,
        Guid targetUserId);

    PresenceSnapshot WatchFriend(
        Guid currentUserId,
        string connectionId,
        Guid targetUserId);

    void UnwatchFriend(
        string connectionId,
        Guid targetUserId);

    // 5.7.8D1:
    // Thu hồi mọi nguồn theo dõi Presence
    // giữa hai người khi mất quyền xem.
    Task RevokeRelationshipAsync(
        Guid firstUserId,
        Guid secondUserId,
        CancellationToken cancellationToken = default);
}

// =====================================================
// PRESENCE SERVICE IMPLEMENTATION
// =====================================================

public sealed class PresenceService(
    IHubContext<ChatHub> hubContext,
    IServiceScopeFactory scopeFactory,
    ILogger<PresenceService> logger
) : IPresenceService
{
    // =====================================================
    // INTERNAL DATA STRUCTURES
    // =====================================================

    private sealed class ConnectionEntry
    {
        public required Guid UserId { get; init; }

        // Một connection có thể theo dõi cùng người
        // từ Messenger và Friends.
        public Dictionary<Guid, WatchEntry> Watches { get; } = [];
    }

    private sealed class WatchEntry
    {
        public Guid? ConversationId { get; set; }

        public bool FriendWatch { get; set; }

        public bool HasSource =>
            ConversationId.HasValue || FriendWatch;
    }

    private sealed record Watcher(
        string ConnectionId,
        Guid ObserverId,
        Guid? ConversationId,
        bool FriendWatch
    );

    private sealed record RevokedWatch(
        string ConnectionId,
        Guid ObserverId,
        Guid TargetUserId
    );

    // =====================================================
    // IN-MEMORY CONNECTION STORAGE
    // =====================================================

    private readonly object _gate = new();

    private readonly Dictionary<string, ConnectionEntry>
        _connections = [];

    private readonly Dictionary<Guid, HashSet<string>>
        _connectionsByUser = [];

    // =====================================================
    // CONNECT
    // =====================================================

    public async Task ConnectedAsync(
        Guid userId,
        string connectionId)
    {
        if (
            userId == Guid.Empty ||
            string.IsNullOrWhiteSpace(connectionId)
        )
        {
            throw new ArgumentException(
                "Thông tin kết nối không hợp lệ.");
        }

        bool becameOnline;

        lock (_gate)
        {
            if (_connections.ContainsKey(connectionId))
            {
                return;
            }

            if (!_connectionsByUser.TryGetValue(
                userId,
                out var connectionIds))
            {
                connectionIds = [];
                _connectionsByUser[userId] = connectionIds;
            }

            becameOnline = connectionIds.Count == 0;

            connectionIds.Add(connectionId);

            _connections[connectionId] =
                new ConnectionEntry
                {
                    UserId = userId
                };
        }

        logger.LogInformation(
            "[Presence] Connected. " +
            "User={UserId}, Connection={ConnectionId}",
            userId,
            connectionId);

        if (becameOnline)
        {
            await PublishPresenceChangedAsync(
                userId,
                true);
        }
    }

    // =====================================================
    // DISCONNECT
    // =====================================================

    public async Task DisconnectedAsync(
        string connectionId)
    {
        Guid userId;
        bool becameOffline = false;

        lock (_gate)
        {
            if (!_connections.Remove(
                connectionId,
                out var entry))
            {
                return;
            }

            userId = entry.UserId;

            if (_connectionsByUser.TryGetValue(
                userId,
                out var connectionIds))
            {
                connectionIds.Remove(connectionId);

                if (connectionIds.Count == 0)
                {
                    _connectionsByUser.Remove(userId);
                    becameOffline = true;
                }
            }
        }

        logger.LogInformation(
            "[Presence] Disconnected. " +
            "User={UserId}, Connection={ConnectionId}",
            userId,
            connectionId);

        if (becameOffline)
        {
            await PublishPresenceChangedAsync(
                userId,
                false);
        }
    }

    // =====================================================
    // WATCH CONVERSATION PRESENCE
    // =====================================================

    public PresenceSnapshot Watch(
        Guid currentUserId,
        string connectionId,
        Guid targetUserId,
        Guid conversationId)
    {
        if (conversationId == Guid.Empty)
        {
            throw new ArgumentException(
                "ConversationId không hợp lệ.");
        }

        lock (_gate)
        {
            var entry = GetOrCreateWatchLocked(
                currentUserId,
                connectionId,
                targetUserId);

            entry.ConversationId = conversationId;

            return SnapshotLocked(targetUserId);
        }
    }

    // =====================================================
    // WATCH FRIEND PRESENCE
    // =====================================================

    public PresenceSnapshot WatchFriend(
        Guid currentUserId,
        string connectionId,
        Guid targetUserId)
    {
        lock (_gate)
        {
            var entry = GetOrCreateWatchLocked(
                currentUserId,
                connectionId,
                targetUserId);

            entry.FriendWatch = true;

            return SnapshotLocked(targetUserId);
        }
    }

    // =====================================================
    // UNWATCH CONVERSATION
    // =====================================================

    public void UnwatchConversation(
        string connectionId,
        Guid targetUserId)
    {
        lock (_gate)
        {
            if (
                _connections.TryGetValue(
                    connectionId,
                    out var connection) &&
                connection.Watches.TryGetValue(
                    targetUserId,
                    out var watch)
            )
            {
                watch.ConversationId = null;

                if (!watch.HasSource)
                {
                    connection.Watches.Remove(
                        targetUserId);
                }
            }
        }
    }

    // =====================================================
    // UNWATCH FRIEND
    // =====================================================

    public void UnwatchFriend(
        string connectionId,
        Guid targetUserId)
    {
        lock (_gate)
        {
            if (
                _connections.TryGetValue(
                    connectionId,
                    out var connection) &&
                connection.Watches.TryGetValue(
                    targetUserId,
                    out var watch)
            )
            {
                watch.FriendWatch = false;

                if (!watch.HasSource)
                {
                    connection.Watches.Remove(
                        targetUserId);
                }
            }
        }
    }

    // =====================================================
    // 5.7.8D1 - REVOKE FRIENDSHIP PRESENCE
    // =====================================================

    public async Task RevokeRelationshipAsync(
        Guid firstUserId,
        Guid secondUserId,
        CancellationToken cancellationToken = default)
    {
        if (
            firstUserId == Guid.Empty ||
            secondUserId == Guid.Empty ||
            firstUserId == secondUserId
        )
        {
            throw new ArgumentException(
                "Cặp UserId không hợp lệ.");
        }

        List<RevokedWatch> revokedWatches = [];

        // =================================================
        // 1. REVOKE WATCHES ATOMICALLY IN MEMORY
        // =================================================

        lock (_gate)
        {
            foreach (var pair in _connections)
            {
                var connectionId = pair.Key;
                var connection = pair.Value;

                Guid targetUserId;

                if (connection.UserId == firstUserId)
                {
                    targetUserId = secondUserId;
                }
                else if (connection.UserId == secondUserId)
                {
                    targetUserId = firstUserId;
                }
                else
                {
                    continue;
                }

                // Xóa toàn bộ nguồn watch của cặp này,
                // gồm FriendWatch và ConversationWatch.
                // Không ảnh hưởng đến người khác.
                if (
                    connection.Watches.Remove(
                        targetUserId)
                )
                {
                    revokedWatches.Add(
                        new RevokedWatch(
                            connectionId,
                            connection.UserId,
                            targetUserId));
                }
            }
        }

        logger.LogInformation(
            "[Presence] Relationship revoked. " +
            "FirstUser={FirstUser}, SecondUser={SecondUser}, " +
            "Connections={Count}",
            firstUserId,
            secondUserId,
            revokedWatches.Count);

        // =================================================
        // 2. NOTIFY ONLY PREVIOUSLY WATCHING CONNECTIONS
        // =================================================

        foreach (var revoked in revokedWatches)
        {
            try
            {
                // Không phát Clients.All hoặc gửi cho
                // người không có đăng ký trước đó.
                //
                // accessRevoked = true có nghĩa là
                // không còn quyền biết Online/Offline.
                // Nó KHÔNG khẳng định người kia Offline.
                await hubContext.Clients
                    .Client(revoked.ConnectionId)
                    .SendAsync(
                        "PresenceChanged",
                        new
                        {
                            userId = revoked.TargetUserId,
                            isOnline = false,
                            accessRevoked = true
                        },
                        cancellationToken);
            }
            catch (OperationCanceledException)
                when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                logger.LogWarning(
                    ex,
                    "[Presence] Revoke notification failed. " +
                    "Observer={ObserverId}, Target={TargetId}, " +
                    "Connection={ConnectionId}",
                    revoked.ObserverId,
                    revoked.TargetUserId,
                    revoked.ConnectionId);
            }
        }
    }

    // =====================================================
    // CREATE OR GET WATCH (LOCK REQUIRED)
    // =====================================================

    private WatchEntry GetOrCreateWatchLocked(
        Guid currentUserId,
        string connectionId,
        Guid targetUserId)
    {
        if (
            currentUserId == Guid.Empty ||
            targetUserId == Guid.Empty ||
            currentUserId == targetUserId ||
            !_connections.TryGetValue(
                connectionId,
                out var connection) ||
            connection.UserId != currentUserId
        )
        {
            throw new InvalidOperationException(
                "Kết nối Presence không hợp lệ.");
        }

        if (!connection.Watches.TryGetValue(
            targetUserId,
            out var watch))
        {
            if (connection.Watches.Count >= 100)
            {
                throw new InvalidOperationException(
                    "Tối đa 100 người được theo dõi " +
                    "trên một kết nối.");
            }

            watch = new WatchEntry();

            connection.Watches[targetUserId] = watch;
        }

        return watch;
    }

    // =====================================================
    // SNAPSHOT (LOCK REQUIRED)
    // =====================================================

    private PresenceSnapshot SnapshotLocked(
        Guid userId)
    {
        var isOnline =
            _connectionsByUser.TryGetValue(
                userId,
                out var connections) &&
            connections.Count > 0;

        return new PresenceSnapshot(
            userId,
            isOnline);
    }

    // =====================================================
    // NOTIFY AUTHORIZED WATCHERS
    // =====================================================

    private async Task PublishPresenceChangedAsync(
        Guid userId,
        bool isOnline)
    {
        List<Watcher> watchers;

        lock (_gate)
        {
            watchers = _connections
                .Where(pair =>
                    pair.Value.Watches.ContainsKey(userId))
                .Select(pair =>
                    new Watcher(
                        pair.Key,
                        pair.Value.UserId,
                        pair.Value.Watches[userId]
                            .ConversationId,
                        pair.Value.Watches[userId]
                            .FriendWatch))
                .ToList();
        }

        foreach (var watcher in watchers)
        {
            try
            {
                // =========================================
                // 1. REVALIDATE CURRENT RELATIONSHIP
                // =========================================

                using var scope =
                    scopeFactory.CreateScope();

                var db = scope.ServiceProvider
                    .GetRequiredService<AppDbContext>();

                var activeUsers = await db.Users
                    .AsNoTracking()
                    .CountAsync(u =>
                        (
                            u.Id == watcher.ObserverId ||
                            u.Id == userId
                        ) && u.IsActive);

                var friends =
                    activeUsers == 2 &&
                    await db.Friendships
                        .AsNoTracking()
                        .AnyAsync(f =>
                            (
                                f.UserAId ==
                                    watcher.ObserverId &&
                                f.UserBId == userId
                            ) ||
                            (
                                f.UserAId == userId &&
                                f.UserBId ==
                                    watcher.ObserverId
                            ));

                var blocked =
                    friends &&
                    await db.UserBlocks
                        .AsNoTracking()
                        .AnyAsync(b =>
                            (
                                b.BlockerId ==
                                    watcher.ObserverId &&
                                b.BlockedId == userId
                            ) ||
                            (
                                b.BlockerId == userId &&
                                b.BlockedId ==
                                    watcher.ObserverId
                            ));

                // =========================================
                // 2. REVOKE INVALID WATCH
                // =========================================

                if (!friends || blocked)
                {
                    lock (_gate)
                    {
                        if (_connections.TryGetValue(
                            watcher.ConnectionId,
                            out var connection))
                        {
                            connection.Watches.Remove(
                                userId);
                        }
                    }

                    continue;
                }

                // =========================================
                // 3. VALIDATE CONVERSATION WATCH
                // =========================================

                if (!watcher.FriendWatch)
                {
                    if (!watcher.ConversationId.HasValue)
                    {
                        continue;
                    }

                    var conversations =
                        scope.ServiceProvider
                            .GetRequiredService<
                                IConversationService>();

                    var conversation =
                        await conversations.GetByIdAsync(
                            watcher.ConversationId.Value,
                            watcher.ObserverId);

                    if (
                        conversation is null ||
                        !conversation.CanSendMessage ||
                        conversation.Type != 1 ||
                        conversation.OtherUserId != userId
                    )
                    {
                        UnwatchConversation(
                            watcher.ConnectionId,
                            userId);

                        continue;
                    }
                }

                // =========================================
                // 4. ENSURE WATCH WAS NOT REVOKED
                // =========================================

                bool stillWatching;

                lock (_gate)
                {
                    stillWatching =
                        _connections.TryGetValue(
                            watcher.ConnectionId,
                            out var connection) &&
                        connection.UserId ==
                            watcher.ObserverId &&
                        connection.Watches.ContainsKey(
                            userId);
                }

                if (!stillWatching)
                {
                    continue;
                }

                // =========================================
                // 5. SEND TO AUTHORIZED CONNECTION
                // =========================================

                await hubContext.Clients
                    .Client(watcher.ConnectionId)
                    .SendAsync(
                        "PresenceChanged",
                        new
                        {
                            userId,
                            isOnline,
                            accessRevoked = false
                        });
            }
            catch (Exception ex)
            {
                logger.LogWarning(
                    ex,
                    "[Presence] Notify failed. " +
                    "User={UserId}, Watcher={WatcherId}",
                    userId,
                    watcher.ObserverId);
            }
        }
    }
}
