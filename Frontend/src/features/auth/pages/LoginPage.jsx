import { useState } from "react";
import {
  Link,
  Navigate,
  useLocation,
  useNavigate,
} from "react-router-dom";

import { useAuth } from "../hooks/useAuth";
import { getAuthError } from "../api/authApi";
import "../../../styles/auth.css";

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();

  const {
    login,
    isAuthenticated,
    isInitializing,
    isLoggingIn,
  } = useAuth();

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");

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

    if (!identifier.trim() || !password) {
      setError("Vui lòng nhập đầy đủ thông tin.");
      return;
    }

    try {
      await login(identifier.trim(), password);

      const redirect =
        location.state?.from?.pathname || "/messenger";

      navigate(
        redirect.startsWith("/") &&
          !redirect.startsWith("//")
          ? redirect
          : "/messenger",
        { replace: true }
      );
    } catch (err) {
      setError(getAuthError(err));
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
              KẾT NỐI KHÔNG GIỚI HẠN
            </div>

            <h1>
              Những cuộc trò chuyện
              <span> tuyệt vời bắt đầu tại đây.</span>
            </h1>

            <p>
              Kết nối bạn bè, chia sẻ khoảnh khắc và
              trò chuyện theo cách của riêng bạn.
            </p>

            <div className="intro-feature-list">
              <div><span>✓</span> Kết nối bạn bè dễ dàng</div>
              <div><span>✓</span> Trò chuyện mọi lúc, mọi nơi</div>
              <div><span>✓</span> Không gian riêng của bạn</div>
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
                CHÀO MỪNG TRỞ LẠI
              </div>
              <h2>Đăng nhập</h2>
              <p>
                Đăng nhập để tiếp tục cuộc trò chuyện.
              </p>
            </div>

            <form onSubmit={handleSubmit}>
              {error && (
                <div className="auth-error" role="alert">
                  {error}
                </div>
              )}

              <div className="form-field">
                <label htmlFor="identifier">
                  Username hoặc Email
                </label>
                <input
                  id="identifier"
                  type="text"
                  placeholder="Nhập username hoặc email"
                  autoComplete="username"
                  maxLength={256}
                  value={identifier}
                  onChange={(e) =>
                    setIdentifier(e.target.value)
                  }
                  required
                />
              </div>

              <div className="form-field">
                <label htmlFor="password">
                  Mật khẩu
                </label>
                <div className="password-field">
                  <input
                    id="password"
                    type={
                      showPassword ? "text" : "password"
                    }
                    placeholder="Nhập mật khẩu"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) =>
                      setPassword(e.target.value)
                    }
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

              <button
                className="auth-submit"
                type="submit"
                disabled={isLoggingIn}
              >
                {isLoggingIn
                  ? "Đang đăng nhập..."
                  : "Đăng nhập"}
              </button>
            </form>

            <div className="auth-divider">
              <span>HOẶC</span>
            </div>

            <p className="auth-bottom-text">
              Chưa có tài khoản?{" "}
              <Link to="/register">
                Tạo tài khoản ngay
              </Link>
            </p>

            <div className="auth-demo-note">
              WebChat • Đăng nhập an toàn bằng JWT
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}