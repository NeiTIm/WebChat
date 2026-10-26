using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using WebChat.Api.Models;

namespace WebChat.Api.Data.Configurations;

public sealed class FriendRequestConfiguration
    : IEntityTypeConfiguration<FriendRequest>
{
    public void Configure(
        EntityTypeBuilder<FriendRequest> builder)
    {
        builder.ToTable("FriendRequests", table =>
        {
            table.HasCheckConstraint(
                "CK_FriendRequests_DifferentUsers",
                "[SenderId] <> [ReceiverId]");

            table.HasCheckConstraint(
                "CK_FriendRequests_Status",
                "[Status] IN (0, 1, 2, 3)");

            table.HasCheckConstraint(
                "CK_FriendRequests_StatusDates",
                """
                (
                    (
                        [Status] = 0
                        AND [RespondedAtUtc] IS NULL
                        AND [CancelledAtUtc] IS NULL
                    )
                    OR
                    (
                        [Status] IN (1, 2)
                        AND [RespondedAtUtc] IS NOT NULL
                        AND [CancelledAtUtc] IS NULL
                        AND [RespondedAtUtc] >= [CreatedAtUtc]
                    )
                    OR
                    (
                        [Status] = 3
                        AND [RespondedAtUtc] IS NULL
                        AND [CancelledAtUtc] IS NOT NULL
                        AND [CancelledAtUtc] >= [CreatedAtUtc]
                    )
                )
                """);
        });

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedNever();

        builder.Property(x => x.Status)
            .HasConversion<byte>()
            .HasColumnType("tinyint")
            .IsRequired();

        builder.Property(x => x.CreatedAtUtc)
            .HasColumnType("datetime2(7)")
            .IsRequired();

        builder.Property(x => x.RespondedAtUtc)
            .HasColumnType("datetime2(7)");

        builder.Property(x => x.CancelledAtUtc)
            .HasColumnType("datetime2(7)");

        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(x => x.SenderId)
            .OnDelete(DeleteBehavior.NoAction);

        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(x => x.ReceiverId)
            .OnDelete(DeleteBehavior.NoAction);

        // SQL Server tính và lưu cặp GUID chuẩn hóa.
        // Đây là shadow properties, không được gán từ C#.

        builder.Property<Guid>("PairLowId")
            .HasComputedColumnSql(
                """
                CASE
                    WHEN [SenderId] < [ReceiverId]
                    THEN [SenderId]
                    ELSE [ReceiverId]
                END
                """,
                stored: true);

        builder.Property<Guid>("PairHighId")
            .HasComputedColumnSql(
                """
                CASE
                    WHEN [SenderId] < [ReceiverId]
                    THEN [ReceiverId]
                    ELSE [SenderId]
                END
                """,
                stored: true);

        // Chỉ một Pending Request trên mỗi cặp A-B,
        // kể cả khi lời mời được gửi ngược chiều.
        builder.HasIndex(
                "PairLowId",
                "PairHighId")
            .IsUnique()
            .HasFilter("[Status] = 0")
            .HasDatabaseName(
                "UX_FriendRequests_PendingPair");

        // Danh sách lời mời đã nhận.
        builder.HasIndex(x => new
            {
                x.ReceiverId,
                x.Status,
                x.CreatedAtUtc,
                x.Id
            })
            .IsDescending(false, false, true, false)
            .HasDatabaseName(
                "IX_FriendRequests_Received");

        // Danh sách lời mời đã gửi.
        builder.HasIndex(x => new
            {
                x.SenderId,
                x.Status,
                x.CreatedAtUtc,
                x.Id
            })
            .IsDescending(false, false, true, false)
            .HasDatabaseName(
                "IX_FriendRequests_Sent");
    }
}