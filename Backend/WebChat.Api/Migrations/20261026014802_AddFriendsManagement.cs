using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace WebChat.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddFriendsManagement : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "FriendAuditLogs",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ActorUserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    TargetUserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    EventType = table.Column<string>(type: "varchar(40)", unicode: false, maxLength: 40, nullable: false),
                    EntityId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    OccurredAtUtc = table.Column<DateTime>(type: "datetime2(7)", nullable: false),
                    MetadataJson = table.Column<string>(type: "nvarchar(max)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FriendAuditLogs", x => x.Id);
                    table.CheckConstraint("CK_FriendAuditLogs_EventType", "[EventType] IN (\r\n    'FriendRequest.Sent',\r\n    'FriendRequest.Accepted',\r\n    'FriendRequest.Rejected',\r\n    'FriendRequest.Cancelled',\r\n    'Friendship.Created',\r\n    'Friendship.Removed',\r\n    'UserBlock.Created',\r\n    'UserBlock.Removed'\r\n)");
                    table.CheckConstraint("CK_FriendAuditLogs_MetadataJson", "[MetadataJson] IS NULL OR ISJSON([MetadataJson]) = 1");
                    table.ForeignKey(
                        name: "FK_FriendAuditLogs_Users_ActorUserId",
                        column: x => x.ActorUserId,
                        principalTable: "Users",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_FriendAuditLogs_Users_TargetUserId",
                        column: x => x.TargetUserId,
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "FriendRequests",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    SenderId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ReceiverId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Status = table.Column<byte>(type: "tinyint", nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime2(7)", nullable: false),
                    RespondedAtUtc = table.Column<DateTime>(type: "datetime2(7)", nullable: true),
                    CancelledAtUtc = table.Column<DateTime>(type: "datetime2(7)", nullable: true),
                    PairHighId = table.Column<Guid>(type: "uniqueidentifier", nullable: false, computedColumnSql: "CASE\r\n    WHEN [SenderId] < [ReceiverId]\r\n    THEN [ReceiverId]\r\n    ELSE [SenderId]\r\nEND", stored: true),
                    PairLowId = table.Column<Guid>(type: "uniqueidentifier", nullable: false, computedColumnSql: "CASE\r\n    WHEN [SenderId] < [ReceiverId]\r\n    THEN [SenderId]\r\n    ELSE [ReceiverId]\r\nEND", stored: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FriendRequests", x => x.Id);
                    table.CheckConstraint("CK_FriendRequests_DifferentUsers", "[SenderId] <> [ReceiverId]");
                    table.CheckConstraint("CK_FriendRequests_Status", "[Status] IN (0, 1, 2, 3)");
                    table.CheckConstraint("CK_FriendRequests_StatusDates", "(\r\n    (\r\n        [Status] = 0\r\n        AND [RespondedAtUtc] IS NULL\r\n        AND [CancelledAtUtc] IS NULL\r\n    )\r\n    OR\r\n    (\r\n        [Status] IN (1, 2)\r\n        AND [RespondedAtUtc] IS NOT NULL\r\n        AND [CancelledAtUtc] IS NULL\r\n        AND [RespondedAtUtc] >= [CreatedAtUtc]\r\n    )\r\n    OR\r\n    (\r\n        [Status] = 3\r\n        AND [RespondedAtUtc] IS NULL\r\n        AND [CancelledAtUtc] IS NOT NULL\r\n        AND [CancelledAtUtc] >= [CreatedAtUtc]\r\n    )\r\n)");
                    table.ForeignKey(
                        name: "FK_FriendRequests_Users_ReceiverId",
                        column: x => x.ReceiverId,
                        principalTable: "Users",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_FriendRequests_Users_SenderId",
                        column: x => x.SenderId,
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "Friendships",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    UserAId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    UserBId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime2(7)", nullable: false),
                    PairHighId = table.Column<Guid>(type: "uniqueidentifier", nullable: false, computedColumnSql: "CASE\r\n    WHEN [UserAId] < [UserBId]\r\n    THEN [UserBId]\r\n    ELSE [UserAId]\r\nEND", stored: true),
                    PairLowId = table.Column<Guid>(type: "uniqueidentifier", nullable: false, computedColumnSql: "CASE\r\n    WHEN [UserAId] < [UserBId]\r\n    THEN [UserAId]\r\n    ELSE [UserBId]\r\nEND", stored: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Friendships", x => x.Id);
                    table.CheckConstraint("CK_Friendships_DifferentUsers", "[UserAId] <> [UserBId]");
                    table.ForeignKey(
                        name: "FK_Friendships_Users_UserAId",
                        column: x => x.UserAId,
                        principalTable: "Users",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_Friendships_Users_UserBId",
                        column: x => x.UserBId,
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "UserBlocks",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    BlockerId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    BlockedId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime2(7)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UserBlocks", x => x.Id);
                    table.CheckConstraint("CK_UserBlocks_DifferentUsers", "[BlockerId] <> [BlockedId]");
                    table.ForeignKey(
                        name: "FK_UserBlocks_Users_BlockedId",
                        column: x => x.BlockedId,
                        principalTable: "Users",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_UserBlocks_Users_BlockerId",
                        column: x => x.BlockerId,
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_FriendAuditLogs_Actor",
                table: "FriendAuditLogs",
                columns: new[] { "ActorUserId", "OccurredAtUtc", "Id" },
                descending: new[] { false, true, false });

            migrationBuilder.CreateIndex(
                name: "IX_FriendAuditLogs_Entity",
                table: "FriendAuditLogs",
                column: "EntityId");

            migrationBuilder.CreateIndex(
                name: "IX_FriendAuditLogs_Target",
                table: "FriendAuditLogs",
                columns: new[] { "TargetUserId", "OccurredAtUtc", "Id" },
                descending: new[] { false, true, false });

            migrationBuilder.CreateIndex(
                name: "IX_FriendRequests_Received",
                table: "FriendRequests",
                columns: new[] { "ReceiverId", "Status", "CreatedAtUtc", "Id" },
                descending: new[] { false, false, true, false });

            migrationBuilder.CreateIndex(
                name: "IX_FriendRequests_Sent",
                table: "FriendRequests",
                columns: new[] { "SenderId", "Status", "CreatedAtUtc", "Id" },
                descending: new[] { false, false, true, false });

            migrationBuilder.CreateIndex(
                name: "UX_FriendRequests_PendingPair",
                table: "FriendRequests",
                columns: new[] { "PairLowId", "PairHighId" },
                unique: true,
                filter: "[Status] = 0");

            migrationBuilder.CreateIndex(
                name: "IX_Friendships_UserAId",
                table: "Friendships",
                column: "UserAId");

            migrationBuilder.CreateIndex(
                name: "IX_Friendships_UserBId",
                table: "Friendships",
                column: "UserBId");

            migrationBuilder.CreateIndex(
                name: "UX_Friendships_UserPair",
                table: "Friendships",
                columns: new[] { "PairLowId", "PairHighId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_UserBlocks_Blocked_Blocker",
                table: "UserBlocks",
                columns: new[] { "BlockedId", "BlockerId" });

            migrationBuilder.CreateIndex(
                name: "UX_UserBlocks_Blocker_Blocked",
                table: "UserBlocks",
                columns: new[] { "BlockerId", "BlockedId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "FriendAuditLogs");

            migrationBuilder.DropTable(
                name: "FriendRequests");

            migrationBuilder.DropTable(
                name: "Friendships");

            migrationBuilder.DropTable(
                name: "UserBlocks");
        }
    }
}
