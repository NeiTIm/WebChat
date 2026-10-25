using System.ComponentModel.DataAnnotations;

namespace WebChat.Api.DTOs.Users;

public sealed class UpdateUserProfileRequest
{
    [Required(ErrorMessage = "Tên hiển thị không được để trống.")]
    [StringLength(
        100,
        MinimumLength = 2,
        ErrorMessage = "Tên hiển thị phải có từ 2 đến 100 ký tự.")]
    public string DisplayName { get; set; } = string.Empty;

    [StringLength(
        500,
        ErrorMessage = "Giới thiệu không được vượt quá 500 ký tự.")]
    public string? Bio { get; set; }

    [StringLength(
        2048,
        ErrorMessage = "Đường dẫn ảnh quá dài.")]
    public string? AvatarUrl { get; set; }
}