using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace WebChat.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddConversationMemberDeliveryCursor : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "LastDeliveredAtUtc",
                table: "ConversationMembers",
                type: "datetime2(7)",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "LastDeliveredSequence",
                table: "ConversationMembers",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddCheckConstraint(
                name: "CK_ConversationMembers_LastDeliveredSequence",
                table: "ConversationMembers",
                sql: "[LastDeliveredSequence] >= 0");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_ConversationMembers_LastDeliveredSequence",
                table: "ConversationMembers");

            migrationBuilder.DropColumn(
                name: "LastDeliveredAtUtc",
                table: "ConversationMembers");

            migrationBuilder.DropColumn(
                name: "LastDeliveredSequence",
                table: "ConversationMembers");
        }
    }
}
