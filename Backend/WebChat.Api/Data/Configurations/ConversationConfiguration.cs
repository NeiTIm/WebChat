using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using WebChat.Api.Models;

namespace WebChat.Api.Data.Configurations;

public sealed class ConversationConfiguration
    : IEntityTypeConfiguration<Conversation>
{
    public void Configure(
        EntityTypeBuilder<Conversation> builder)
    {
        builder.ToTable("Conversations", table =>
        {
            table.HasCheckConstraint(
                "CK_Conversations_TypeAndPrivatePair",
                """
                (
                    [Type] = 1
                    AND [PrivateUserLowId] IS NOT NULL
                    AND [PrivateUserHighId] IS NOT NULL
                    AND [PrivateUserLowId] < [PrivateUserHighId]
                )
                OR
                (
                    [Type] = 2
                    AND [PrivateUserLowId] IS NULL
                    AND [PrivateUserHighId] IS NULL
                )
                """
            );

            table.HasCheckConstraint(
                "CK_Conversations_LastMessageSequence",
                "[LastMessageSequence] >= 0"
            );
        });

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedNever();

        builder.Property(x => x.Type)
            .HasColumnType("tinyint")
            .IsRequired();

        builder.Property(x => x.CreatedAtUtc)
            .HasColumnType("datetime2(7)")
            .IsRequired();

        builder.Property(x => x.LastMessageAtUtc)
            .HasColumnType("datetime2(7)");

        builder.Property(x => x.UpdatedAtUtc)
            .HasColumnType("datetime2(7)");

        builder.Property(x => x.LastMessageSequence)
            .HasColumnType("bigint")
            .HasDefaultValue(0L)
            .IsRequired();

        // Một cặp Users chỉ có một Private Conversation.
        builder.HasIndex(
                x => new
                {
                    x.PrivateUserLowId,
                    x.PrivateUserHighId
                },
                "UX_Conversations_PrivatePair"
            )
            .IsUnique()
            .HasFilter("[Type] = 1");

        builder.HasIndex(
            x => new
            {
                x.LastMessageAtUtc,
                x.Id
            },
            "IX_Conversations_LastMessageAtUtc"
        );

        // FK tới Users đang tồn tại.
        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(x => x.PrivateUserLowId)
            .OnDelete(DeleteBehavior.NoAction);

        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(x => x.PrivateUserHighId)
            .OnDelete(DeleteBehavior.NoAction);

        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(x => x.CreatedByUserId)
            .OnDelete(DeleteBehavior.NoAction);

        builder.HasMany(x => x.Members)
            .WithOne(x => x.Conversation)
            .HasForeignKey(x => x.ConversationId)
            .OnDelete(DeleteBehavior.NoAction);

        builder.HasMany(x => x.Messages)
            .WithOne(x => x.Conversation)
            .HasForeignKey(x => x.ConversationId)
            .OnDelete(DeleteBehavior.NoAction);
    }
}