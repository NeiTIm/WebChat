
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using WebChat.Api.Models;

namespace WebChat.Api.Data.Configurations;

public sealed class ConversationMemberConfiguration
    : IEntityTypeConfiguration<ConversationMember>
{
    public void Configure(
        EntityTypeBuilder<ConversationMember> builder)
    {
        builder.ToTable("ConversationMembers", table =>
        {
            // =================================================
            // EXISTING - READ CURSOR
            // =================================================

            table.HasCheckConstraint(
                "CK_ConversationMembers_LastReadSequence",
                "[LastReadSequence] >= 0"
            );

            // =================================================
            // PHASE 5.8D1 - DELIVERY CURSOR
            // =================================================

            table.HasCheckConstraint(
                "CK_ConversationMembers_LastDeliveredSequence",
                "[LastDeliveredSequence] >= 0"
            );

            // =================================================
            // EXISTING - MEMBERSHIP
            // =================================================

            table.HasCheckConstraint(
                "CK_ConversationMembers_LeftAtUtc",
                "[LeftAtUtc] IS NULL OR " +
                "[LeftAtUtc] >= [JoinedAtUtc]"
            );
        });

        // =====================================================
        // PRIMARY KEY
        // =====================================================

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedNever();

        // =====================================================
        // MEMBERSHIP DATES
        // =====================================================

        builder.Property(x => x.JoinedAtUtc)
            .HasColumnType("datetime2(7)")
            .IsRequired();

        builder.Property(x => x.LeftAtUtc)
            .HasColumnType("datetime2(7)");

        // =====================================================
        // PHASE 5.8A - READ CURSOR
        // =====================================================

        builder.Property(x => x.LastReadSequence)
            .HasColumnType("bigint")
            .HasDefaultValue(0L)
            .IsRequired();

        builder.Property(x => x.LastReadAtUtc)
            .HasColumnType("datetime2(7)");

        // =====================================================
        // PHASE 5.8D1 - DELIVERY CURSOR
        // =====================================================

        builder.Property(x => x.LastDeliveredSequence)
            .HasColumnType("bigint")
            .HasDefaultValue(0L)
            .IsRequired();

        builder.Property(x => x.LastDeliveredAtUtc)
            .HasColumnType("datetime2(7)");

        // =====================================================
        // MEMBERSHIP SETTINGS
        // =====================================================

        builder.Property(x => x.IsArchived)
            .HasDefaultValue(false)
            .IsRequired();

        builder.Property(x => x.IsMuted)
            .HasDefaultValue(false)
            .IsRequired();

        // =====================================================
        // EXISTING INDEXES
        // =====================================================

        // Một User chỉ có một Membership
        // trong cùng Conversation.
        builder.HasIndex(
                x => new
                {
                    x.ConversationId,
                    x.UserId
                },
                "UX_ConversationMembers_Conversation_User"
            )
            .IsUnique();

        // Tìm hội thoại theo User.
        builder.HasIndex(
            x => new
            {
                x.UserId,
                x.ConversationId
            },
            "IX_ConversationMembers_User_Conversation"
        );

        // =====================================================
        // EXISTING RELATIONSHIPS
        // =====================================================

        builder.HasOne(x => x.Conversation)
            .WithMany(x => x.Members)
            .HasForeignKey(x => x.ConversationId)
            .OnDelete(DeleteBehavior.NoAction);

        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(x => x.UserId)
            .OnDelete(DeleteBehavior.NoAction);
    }
}
