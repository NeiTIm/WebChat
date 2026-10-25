using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using WebChat.Api.Models;

namespace WebChat.Api.Data.Configurations;

public sealed class UserConfiguration : IEntityTypeConfiguration<User>
{
    public void Configure(EntityTypeBuilder<User> builder)
    {
        builder.ToTable("Users");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Username)
            .HasMaxLength(50).IsRequired();

        builder.Property(x => x.NormalizedUsername)
            .HasMaxLength(50).IsRequired();

        builder.HasIndex(x => x.NormalizedUsername)
            .IsUnique();

        builder.Property(x => x.Email)
            .HasMaxLength(256).IsRequired();

        builder.Property(x => x.NormalizedEmail)
            .HasMaxLength(256).IsRequired();

        builder.HasIndex(x => x.NormalizedEmail)
            .IsUnique();

        builder.Property(x => x.PasswordHash)
            .HasMaxLength(512).IsRequired();

        builder.Property(x => x.DisplayName)
            .HasMaxLength(100).IsRequired();

        builder.Property(x => x.AvatarUrl)
            .HasMaxLength(2048);

        builder.Property(x => x.Bio)
            .HasMaxLength(500);

        builder.Property(x => x.IsActive)
            .HasDefaultValue(true);

        builder.Property(x => x.IsEmailVerified)
            .HasDefaultValue(false);

        builder.Property(x => x.CreatedAtUtc)
            .HasColumnType("datetime2");
    }
}