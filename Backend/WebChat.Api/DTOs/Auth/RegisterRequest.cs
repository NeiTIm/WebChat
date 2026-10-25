using System.ComponentModel.DataAnnotations;

namespace WebChat.Api.DTOs.Auth;

public sealed class RegisterRequest
{
    [Required(ErrorMessage = "Username không được để trống.")]
    [StringLength(50, MinimumLength = 3,
        ErrorMessage = "Username phải có từ 3 đến 50 ký tự.")]
    [RegularExpression(@"^[a-zA-Z0-9_]+$",
        ErrorMessage = "Username chỉ được chứa chữ, số và dấu gạch dưới.")]
    public string Username { get; set; } = string.Empty;

    [Required(ErrorMessage = "Email không được để trống.")]
    [EmailAddress(ErrorMessage = "Email không hợp lệ.")]
    [StringLength(256)]
    public string Email { get; set; } = string.Empty;

    [Required(ErrorMessage = "Mật khẩu không được để trống.")]
    [StringLength(128, MinimumLength = 8,
        ErrorMessage = "Mật khẩu phải có từ 8 đến 128 ký tự.")]
    public string Password { get; set; } = string.Empty;

    [Required(ErrorMessage = "Tên hiển thị không được để trống.")]
    [StringLength(100, MinimumLength = 2)]
    public string DisplayName { get; set; } = string.Empty;
}