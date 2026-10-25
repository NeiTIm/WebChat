import { useState } from "react";
import {
  Link,
  Navigate,
  useNavigate,
} from "react-router-dom";

import { useAuth } from "../hooks/useAuth";
import { getAuthError } from "../api/authApi";
import "../../../styles/auth.css";

export default function RegisterPage() {
  const navigate = useNavigate();

  const {
    register,
    isAuthenticated,
    isInitializing,
  } = useAuth();

  const [form, setForm] = useState({
    username: "",
    email: "",
    displayName: "",
    password: "",
    confirmPassword: "",
  });

  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  function updateField(event) {
    const { name, value } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: value,
    }));
  }

  if (isInitializing) {
    return (
      <div className="app-loading">
        <div className="loading-spinner" />
        <p>Đang tải WebChat...</p>
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/messenger" replace />;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");

    if (form.password !== form.confirmPassword) {
      setError("Mật khẩu xác nhận không khớp.");
      return;
    }

    if (form.password.length < 8) {
      setError("Mật khẩu phải có ít nhất 8 ký tự.");
      return;
    }

    setIsSubmitting(true);

    try {
      await register({
        username: form.username.trim(),
        email: form.email.trim(),
        displayName: form.displayName.trim(),
        password: form.password,
      });

      navigate("/login", {
        replace: true,
        state: {
          success:
            "Tạo tài khoản thành công. Hãy đăng nhập.",
        },
      });
    } catch (err) {
      setError(getAuthError(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-shell">
        <section className="auth-intro">
          <div className="brand-mark">
            <span className="brand-symbol">W</span>
            <span>WebChat</span>
          </div>

          <div className="auth-intro-content">
            <div className="intro-eyebrow">
              THAM GIA CỘNG ĐỒNG
            </div>

            <h1>
              Gần nhau hơn,
              <span> dù ở bất kỳ đâu.</span>
            </h1>

            <p>
              Tạo tài khoản miễn phí để bắt đầu
              kết nối và trò chuyện cùng bạn bè.
            </p>

            <div className="intro-feature-list">
              <div><span>✓</span> Tạo tài khoản nhanh chóng</div>
              <div><span>✓</span> Kết nối mọi người</div>
              <div><span>✓</span> Bảo vệ phiên đăng nhập</div>
            </div>
          </div>

          <div className="intro-footer">
            © 2026 WebChat
          </div>
        </section>

        <section className="auth-form-side">
          <div className="auth-form-box">
            <div className="mobile-brand">
              <span className="brand-symbol">W</span>
              WebChat
            </div>

            <div className="form-heading">
              <div className="heading-eyebrow">
                BẮT ĐẦU VỚI WEBCHAT
              </div>

              <h2>Tạo tài khoản</h2>

              <p>
                Tham gia WebChat chỉ với vài bước.
              </p>
            </div>

            <form onSubmit={handleSubmit}>
              {error && (
                <div className="auth-error" role="alert">
                  {error}
                </div>
              )}

              <div className="form-field">
                <label htmlFor="displayName">
                  Tên hiển thị
                </label>
                <input
                  id="displayName"
                  name="displayName"
                  type="text"
                  placeholder="Nguyễn Văn A"
                  minLength={2}
                  maxLength={100}
                  value={form.displayName}
                  onChange={updateField}
                  required
                />
              </div>

              <div className="form-field">
                <label htmlFor="username">
                  Username
                </label>
                <input
                  id="username"
                  name="username"
                  type="text"
                  placeholder="nguyenvana"
                  minLength={3}
                  maxLength={50}
                  pattern="[A-Za-z0-9_]+"
                  title="Chỉ nhập chữ, số hoặc dấu gạch dưới"
                  autoComplete="username"
                  value={form.username}
                  onChange={updateField}
                  required
                />
              </div>

              <div className="form-field">
                <label htmlFor="email">
                  Email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="you@example.com"
                  maxLength={256}
                  autoComplete="email"
                  value={form.email}
                  onChange={updateField}
                  required
                />
              </div>

              <div className="form-field">
                <label htmlFor="newPassword">
                  Mật khẩu
                </label>
                <div className="password-field">
                  <input
                    id="newPassword"
                    name="password"
                    type={
                      showPassword ? "text" : "password"
                    }
                    placeholder="Tối thiểu 8 ký tự"
                    minLength={8}
                    maxLength={128}
                    autoComplete="new-password"
                    value={form.password}
                    onChange={updateField}
                    required
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() =>
                      setShowPassword((v) => !v)
                    }
                  >
                    {showPassword ? "Ẩn" : "Hiện"}
                  </button>
                </div>
              </div>

              <div className="form-field">
                <label htmlFor="confirmPassword">
                  Xác nhận mật khẩu
                </label>
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  placeholder="Nhập lại mật khẩu"
                  minLength={8}
                  autoComplete="new-password"
                  value={form.confirmPassword}
                  onChange={updateField}
                  required
                />
              </div>

              <button
                className="auth-submit"
                type="submit"
                disabled={isSubmitting}
              >
                {isSubmitting
                  ? "Đang tạo tài khoản..."
                  : "Tạo tài khoản"}
              </button>
            </form>

            <p className="auth-bottom-text">
              Đã có tài khoản?{" "}
              <Link to="/login">Đăng nhập</Link>
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}