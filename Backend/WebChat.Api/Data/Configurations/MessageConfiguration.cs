
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using WebChat.Api.Models;

namespace WebChat.Api.Data.Configurations;

public sealed class MessageConfiguration
    : IEntityTypeConfiguration<Message>
{
    public void Configure(
        EntityTypeBuilder<Message> builder)
    {
        builder.ToTable("Messages", table =>
        {
            table.HasCheckConstraint(
                "CK_Messages_Type",
                "[Type] = 1"
            );

            table.HasCheckConstraint(
                "CK_Messages_SequenceNumber",
                "[SequenceNumber] > 0"
            );

            table.HasCheckConstraint(
                "CK_Messages_TextContent",
                """
                (
                    [Type] = 1
                    AND [Content] IS NOT NULL
                    AND LEN(LTRIM(RTRIM([Content]))) > 0
                )
                """
            );

            table.HasCheckConstraint(
                "CK_Messages_ClientMessageId",
                "[ClientMessageId] <> " +
                "'00000000-0000-0000-0000-000000000000'"
            );
        });

        // =====================================================
        // PRIMARY KEY
        // =====================================================

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedNever();

        // =====================================================
        // PROPERTIES
        // =====================================================

        builder.Property(x => x.ClientMessageId)
            .IsRequired();

        builder.Property(x => x.SequenceNumber)
            .HasColumnType("bigint")
            .IsRequired();

        builder.Property(x => x.Type)
            .HasColumnType("tinyint")
            .IsRequired();

        builder.Property(x => x.Content)
            .HasMaxLength(4000)
            .HasColumnType("nvarchar(4000)")
            .IsRequired(false);

        builder.Property(x => x.CreatedAtUtc)
            .HasColumnType("datetime2(7)")
            .IsRequired();

        builder.Property(x => x.EditedAtUtc)
            .HasColumnType("datetime2(7)");

        builder.Property(x => x.RecalledAtUtc)
            .HasColumnType("datetime2(7)");

        // =====================================================
        // UNIQUE INDEXES
        // =====================================================

        // Đảm bảo SequenceNumber không trùng
        // trong cùng một Conversation.
        // Index này cũng phục vụ cursor pagination.
        builder.HasIndex(
                x => new
                {
                    x.ConversationId,
                    x.SequenceNumber
                },
                "UX_Messages_Conversation_Sequence"
            )
            .IsUnique();

        // Chống gửi trùng khi Frontend retry request.
        builder.HasIndex(
                x => new
                {
                    x.SenderId,
                    x.ClientMessageId
                },
                "UX_Messages_Sender_ClientMessage"
            )
            .IsUnique();

        // =====================================================
        // FOREIGN KEYS
        // =====================================================

        builder.HasOne(x => x.Conversation)
            .WithMany(x => x.Messages)
            .HasForeignKey(x => x.ConversationId)
            .OnDelete(DeleteBehavior.NoAction);

        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(x => x.SenderId)
            .OnDelete(DeleteBehavior.NoAction);

        // ReplyToMessageId dành cho giai đoạn sau.
        // Chưa tạo FK Reply tại bước này.
    }
}
