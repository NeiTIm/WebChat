using Microsoft.EntityFrameworkCore;
using WebChat.Api.Models;

namespace WebChat.Api.Data;

public sealed class AppDbContext : DbContext
{
    public AppDbContext(
        DbContextOptions<AppDbContext> options)
        : base(options)
    {
    }

    // ================================================
    // IDENTITY & AUTHENTICATION
    // ================================================

    public DbSet<User> Users => Set<User>();

    public DbSet<Role> Roles => Set<Role>();

    public DbSet<Permission> Permissions => Set<Permission>();

    public DbSet<UserRole> UserRoles => Set<UserRole>();

    public DbSet<RolePermission> RolePermissions
        => Set<RolePermission>();

    public DbSet<RefreshToken> RefreshTokens
        => Set<RefreshToken>();

    public DbSet<UserSession> UserSessions
        => Set<UserSession>();

    // =====================================================
    // FRIENDS MANAGEMENT - PHASE 4
    // =====================================================

    public DbSet<FriendRequest> FriendRequests
        => Set<FriendRequest>();

    public DbSet<Friendship> Friendships
        => Set<Friendship>();

    public DbSet<UserBlock> UserBlocks
        => Set<UserBlock>();

    public DbSet<FriendAuditLog> FriendAuditLogs
        => Set<FriendAuditLog>();
    // =====================================================
    // CHAT - GIAI ĐOẠN 5
    // =====================================================

    public DbSet<Conversation> Conversations
        => Set<Conversation>();

    public DbSet<ConversationMember> ConversationMembers
        => Set<ConversationMember>();

    public DbSet<Message> Messages
        => Set<Message>();
    protected override void OnModelCreating(
        ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.ApplyConfigurationsFromAssembly(
            typeof(AppDbContext).Assembly);
    }
}