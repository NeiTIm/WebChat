using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using WebChat.Api.Models;

namespace WebChat.Api.Data.Configurations;

public sealed class FriendshipConfiguration
    : IEntityTypeConfiguration<Friendship>
{
    public void Configure(
        EntityTypeBuilder<Friendship> builder)
    {
        builder.ToTable("Friendships", table =>
        {
            table.HasCheckConstraint(
                "CK_Friendships_DifferentUsers",
                "[UserAId] <> [UserBId]");
        });

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedNever();

        builder.Property(x => x.CreatedAtUtc)
            .HasColumnType("datetime2(7)")
            .IsRequired();

        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(x => x.UserAId)
            .OnDelete(DeleteBehavior.NoAction);

        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(x => x.UserBId)
            .OnDelete(DeleteBehavior.NoAction);

        builder.Property<Guid>("PairLowId")
            .HasComputedColumnSql(
                """
                CASE
                    WHEN [UserAId] < [UserBId]
                    THEN [UserAId]
                    ELSE [UserBId]
                END
                """,
                stored: true);

        builder.Property<Guid>("PairHighId")
            .HasComputedColumnSql(
                """
                CASE
                    WHEN [UserAId] < [UserBId]
                    THEN [UserBId]
                    ELSE [UserAId]
                END
                """,
                stored: true);

        // Ngăn một cặp bạn bè tồn tại hai lần,
        // bất kể thứ tự UserAId và UserBId.
        builder.HasIndex(
                "PairLowId",
                "PairHighId")
            .IsUnique()
            .HasDatabaseName(
                "UX_Friendships_UserPair");

        builder.HasIndex(x => x.UserAId)
            .HasDatabaseName(
                "IX_Friendships_UserAId");

        builder.HasIndex(x => x.UserBId)
            .HasDatabaseName(
                "IX_Friendships_UserBId");
    }
}