using System.ComponentModel.DataAnnotations;

namespace WebChat.Api.DTOs.Auth;

public sealed class LoginRequest
{
    [Required(ErrorMessage = "Vui lòng nhập username hoặc email.")]
    [StringLength(256)]
    public string Identifier { get; set; } = string.Empty;

    [Required(ErrorMessage = "Vui lòng nhập mật khẩu.")]
    public string Password { get; set; } = string.Empty;
}