using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace WebChat.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddPrivateChatFoundation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Conversations",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Type = table.Column<byte>(type: "tinyint", nullable: false),
                    PrivateUserLowId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    PrivateUserHighId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    CreatedByUserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime2(7)", nullable: false),
                    LastMessageAtUtc = table.Column<DateTime>(type: "datetime2(7)", nullable: true),
                    UpdatedAtUtc = table.Column<DateTime>(type: "datetime2(7)", nullable: true),
                    LastMessageSequence = table.Column<long>(type: "bigint", nullable: false, defaultValue: 0L)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Conversations", x => x.Id);
                    table.CheckConstraint("CK_Conversations_LastMessageSequence", "[LastMessageSequence] >= 0");
                    table.CheckConstraint("CK_Conversations_TypeAndPrivatePair", "(\r\n    [Type] = 1\r\n    AND [PrivateUserLowId] IS NOT NULL\r\n    AND [PrivateUserHighId] IS NOT NULL\r\n    AND [PrivateUserLowId] < [PrivateUserHighId]\r\n)\r\nOR\r\n(\r\n    [Type] = 2\r\n    AND [PrivateUserLowId] IS NULL\r\n    AND [PrivateUserHighId] IS NULL\r\n)");
                    table.ForeignKey(
                        name: "FK_Conversations_Users_CreatedByUserId",
                        column: x => x.CreatedByUserId,
                        principalTable: "Users",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_Conversations_Users_PrivateUserHighId",
                        column: x => x.PrivateUserHighId,
                        principalTable: "Users",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_Conversations_Users_PrivateUserLowId",
                        column: x => x.PrivateUserLowId,
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "ConversationMembers",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ConversationId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    UserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    JoinedAtUtc = table.Column<DateTime>(type: "datetime2(7)", nullable: false),
                    LeftAtUtc = table.Column<DateTime>(type: "datetime2(7)", nullable: true),
                    LastReadSequence = table.Column<long>(type: "bigint", nullable: false, defaultValue: 0L),
                    LastReadAtUtc = table.Column<DateTime>(type: "datetime2(7)", nullable: true),
                    IsArchived = table.Column<bool>(type: "bit", nullable: false, defaultValue: false),
                    IsMuted = table.Column<bool>(type: "bit", nullable: false, defaultValue: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ConversationMembers", x => x.Id);
                    table.CheckConstraint("CK_ConversationMembers_LastReadSequence", "[LastReadSequence] >= 0");
                    table.CheckConstraint("CK_ConversationMembers_LeftAtUtc", "[LeftAtUtc] IS NULL OR [LeftAtUtc] >= [JoinedAtUtc]");
                    table.ForeignKey(
                        name: "FK_ConversationMembers_Conversations_ConversationId",
                        column: x => x.ConversationId,
                        principalTable: "Conversations",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_ConversationMembers_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "Messages",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ConversationId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    SenderId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ClientMessageId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    SequenceNumber = table.Column<long>(type: "bigint", nullable: false),
                    Type = table.Column<byte>(type: "tinyint", nullable: false),
                    Content = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: true),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime2(7)", nullable: false),
                    EditedAtUtc = table.Column<DateTime>(type: "datetime2(7)", nullable: true),
                    RecalledAtUtc = table.Column<DateTime>(type: "datetime2(7)", nullable: true),
                    ReplyToMessageId = table.Column<Guid>(type: "uniqueidentifier", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Messages", x => x.Id);
                    table.CheckConstraint("CK_Messages_ClientMessageId", "[ClientMessageId] <> '00000000-0000-0000-0000-000000000000'");
                    table.CheckConstraint("CK_Messages_SequenceNumber", "[SequenceNumber] > 0");
                    table.CheckConstraint("CK_Messages_TextContent", "(\r\n    [Type] = 1\r\n    AND [Content] IS NOT NULL\r\n    AND LEN(LTRIM(RTRIM([Content]))) > 0\r\n)");
                    table.CheckConstraint("CK_Messages_Type", "[Type] = 1");
                    table.ForeignKey(
                        name: "FK_Messages_Conversations_ConversationId",
                        column: x => x.ConversationId,
                        principalTable: "Conversations",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_Messages_Users_SenderId",
                        column: x => x.SenderId,
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_ConversationMembers_User_Conversation",
                table: "ConversationMembers",
                columns: new[] { "UserId", "ConversationId" });

            migrationBuilder.CreateIndex(
                name: "UX_ConversationMembers_Conversation_User",
                table: "ConversationMembers",
                columns: new[] { "ConversationId", "UserId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Conversations_CreatedByUserId",
                table: "Conversations",
                column: "CreatedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_Conversations_LastMessageAtUtc",
                table: "Conversations",
                columns: new[] { "LastMessageAtUtc", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_Conversations_PrivateUserHighId",
                table: "Conversations",
                column: "PrivateUserHighId");

            migrationBuilder.CreateIndex(
                name: "UX_Conversations_PrivatePair",
                table: "Conversations",
                columns: new[] { "PrivateUserLowId", "PrivateUserHighId" },
                unique: true,
                filter: "[Type] = 1");

            migrationBuilder.CreateIndex(
                name: "UX_Messages_Conversation_Sequence",
                table: "Messages",
                columns: new[] { "ConversationId", "SequenceNumber" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "UX_Messages_Sender_ClientMessage",
                table: "Messages",
                columns: new[] { "SenderId", "ClientMessageId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ConversationMembers");

            migrationBuilder.DropTable(
                name: "Messages");

            migrationBuilder.DropTable(
                name: "Conversations");
        }
    }
}
