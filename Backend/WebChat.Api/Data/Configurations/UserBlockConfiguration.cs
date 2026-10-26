using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using WebChat.Api.Models;

namespace WebChat.Api.Data.Configurations;

public sealed class UserBlockConfiguration
    : IEntityTypeConfiguration<UserBlock>
{
    public void Configure(
        EntityTypeBuilder<UserBlock> builder)
    {
        builder.ToTable("UserBlocks", table =>
        {
            table.HasCheckConstraint(
                "CK_UserBlocks_DifferentUsers",
                "[BlockerId] <> [BlockedId]");
        });

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedNever();

        builder.Property(x => x.CreatedAtUtc)
            .HasColumnType("datetime2(7)")
            .IsRequired();

        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(x => x.BlockerId)
            .OnDelete(DeleteBehavior.NoAction);

        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(x => x.BlockedId)
            .OnDelete(DeleteBehavior.NoAction);

        // Block là quan hệ có hướng:
        // A chặn B khác với B chặn A.
        builder.HasIndex(x => new
            {
                x.BlockerId,
                x.BlockedId
            })
            .IsUnique()
            .HasDatabaseName(
                "UX_UserBlocks_Blocker_Blocked");

        builder.HasIndex(x => new
            {
                x.BlockedId,
                x.BlockerId
            })
            .HasDatabaseName(
                "IX_UserBlocks_Blocked_Blocker");
    }
}