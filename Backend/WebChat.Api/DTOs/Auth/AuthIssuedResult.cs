namespace WebChat.Api.DTOs.Auth;

// Kết quả nội bộ giữa Service và Controller.
// RefreshToken không được đưa vào JSON trả cho client.
public sealed record AuthIssuedResult(
    LoginResponse Result,
    string RefreshToken);