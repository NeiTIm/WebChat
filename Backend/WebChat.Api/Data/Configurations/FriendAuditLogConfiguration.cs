using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using WebChat.Api.Models;

namespace WebChat.Api.Data.Configurations;

public sealed class FriendAuditLogConfiguration
    : IEntityTypeConfiguration<FriendAuditLog>
{
    public void Configure(
        EntityTypeBuilder<FriendAuditLog> builder)
    {
        builder.ToTable("FriendAuditLogs", table =>
        {
            table.HasCheckConstraint(
                "CK_FriendAuditLogs_EventType",
                """
                [EventType] IN (
                    'FriendRequest.Sent',
                    'FriendRequest.Accepted',
                    'FriendRequest.Rejected',
                    'FriendRequest.Cancelled',
                    'Friendship.Created',
                    'Friendship.Removed',
                    'UserBlock.Created',
                    'UserBlock.Removed'
                )
                """);

            table.HasCheckConstraint(
                "CK_FriendAuditLogs_MetadataJson",
                "[MetadataJson] IS NULL OR ISJSON([MetadataJson]) = 1");
        });

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedNever();

        builder.Property(x => x.EventType)
            .HasMaxLength(40)
            .IsUnicode(false)
            .IsRequired();

        builder.Property(x => x.OccurredAtUtc)
            .HasColumnType("datetime2(7)")
            .IsRequired();

        builder.Property(x => x.MetadataJson)
            .HasColumnType("nvarchar(max)");

        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(x => x.ActorUserId)
            .OnDelete(DeleteBehavior.NoAction);

        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(x => x.TargetUserId)
            .OnDelete(DeleteBehavior.NoAction);

        builder.HasIndex(x => new
            {
                x.ActorUserId,
                x.OccurredAtUtc,
                x.Id
            })
            .IsDescending(false, true, false)
            .HasDatabaseName(
                "IX_FriendAuditLogs_Actor");

        builder.HasIndex(x => new
            {
                x.TargetUserId,
                x.OccurredAtUtc,
                x.Id
            })
            .IsDescending(false, true, false)
            .HasDatabaseName(
                "IX_FriendAuditLogs_Target");

        builder.HasIndex(x => x.EntityId)
            .HasDatabaseName(
                "IX_FriendAuditLogs_Entity");
    }
}