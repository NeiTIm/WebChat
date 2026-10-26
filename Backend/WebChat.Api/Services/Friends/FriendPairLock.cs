using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using WebChat.Api.Data;

namespace WebChat.Api.Services.Friends;

public static class FriendPairLock
{
    public static async Task AcquireAsync(
        AppDbContext db,
        Guid userA,
        Guid userB,
        CancellationToken ct = default)
    {
        if (userA == Guid.Empty ||
            userB == Guid.Empty ||
            userA == userB)
        {
            throw new FriendRequestException(
                "Cặp người dùng không hợp lệ.",
                400);
        }

        var transaction = db.Database.CurrentTransaction;

        if (transaction is null)
        {
            throw new InvalidOperationException(
                "Phải mở transaction trước khi lấy Friend Pair Lock.");
        }

        // Cùng thuật toán đã sử dụng trong Bước 4.3.
        var a = userA.ToString("N");
        var b = userB.ToString("N");

        var first = string.CompareOrdinal(a, b) <= 0 ? a : b;
        var second = string.CompareOrdinal(a, b) <= 0 ? b : a;

        var resource = $"webchat:friends:{first}:{second}";

        await db.Database.OpenConnectionAsync(ct);

        var connection = db.Database.GetDbConnection();

        await using var command = connection.CreateCommand();

        command.Transaction = transaction.GetDbTransaction();

        command.CommandType = CommandType.Text;

        command.CommandText = """
            DECLARE @result int;

            EXEC @result = sys.sp_getapplock
                @Resource = @resource,
                @LockMode = 'Exclusive',
                @LockOwner = 'Transaction',
                @LockTimeout = 10000;

            SELECT @result;
            """;

        var parameter = command.CreateParameter();
        parameter.ParameterName = "@resource";
        parameter.DbType = DbType.String;
        parameter.Size = 255;
        parameter.Value = resource;

        command.Parameters.Add(parameter);

        var result = await command.ExecuteScalarAsync(ct);

        if (result is null || result is DBNull)
        {
            throw new InvalidOperationException(
                "Không nhận được kết quả từ sp_getapplock.");
        }

        var lockResult = Convert.ToInt32(result);

        if (lockResult < 0)
        {
            throw new FriendRequestException(
                "Một thao tác khác đang xử lý quan hệ này. " +
                "Vui lòng thử lại.",
                409);
        }
    }
}