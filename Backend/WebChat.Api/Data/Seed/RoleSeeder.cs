using Microsoft.EntityFrameworkCore;
using WebChat.Api.Models;

namespace WebChat.Api.Data.Seed;

public static class RoleSeeder
{
    public const string UserRole = "User";
    public const string AdminRole = "Admin";

    public static async Task SeedAsync(
        AppDbContext dbContext,
        CancellationToken cancellationToken = default)
    {
        var systemRoles = new[]
        {
            new
            {
                Name = UserRole,
                Description = "Người dùng thông thường của WebChat."
            },
            new
            {
                Name = AdminRole,
                Description = "Quản trị viên hệ thống WebChat."
            }
        };

        foreach (var systemRole in systemRoles)
        {
            var normalizedName =
                systemRole.Name.ToUpperInvariant();

            var existingRole = await dbContext.Roles
                .FirstOrDefaultAsync(
                    x => x.NormalizedName == normalizedName,
                    cancellationToken);

            if (existingRole is not null)
            {
                // Không tự ý đổi Role hiện có.
                // Role hệ thống bắt buộc phải hợp lệ.
                if (!existingRole.IsSystem ||
                    !existingRole.IsActive)
                {
                    throw new InvalidOperationException(
                        $"Role hệ thống '{systemRole.Name}' " +
                        "đã tồn tại nhưng không hợp lệ.");
                }

                continue;
            }

            dbContext.Roles.Add(new Role
            {
                Id = Guid.NewGuid(),
                Name = systemRole.Name,
                NormalizedName = normalizedName,
                Description = systemRole.Description,
                IsSystem = true,
                IsActive = true,
                CreatedAtUtc = DateTime.UtcNow
            });
        }

        await dbContext.SaveChangesAsync(cancellationToken);
    }
}