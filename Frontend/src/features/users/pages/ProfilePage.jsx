import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  Save,
  UserRound,
} from "lucide-react";

import { useAuth } from "../../auth/hooks/useAuth";
import { getAuthError } from "../../auth/api/authApi";
import { userApi } from "../api/userApi";

import "../../../styles/profile.css";

function getInitials(name) {
  return (name || "U")
    .trim()
    .split(/\s+/)
    .slice(-2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}

function AvatarPreview({ url, name }) {
  const [failedUrl, setFailedUrl] = useState(null);

  if (url && failedUrl !== url) {
    return (
      <img
        className="profile-avatar-image"
        src={url}
        alt={`Ảnh đại diện của ${name}`}
        onError={() => setFailedUrl(url)}
        referrerPolicy="no-referrer"
      />
    );
  }

  return (
    <div className="profile-avatar-fallback">
      {getInitials(name)}
    </div>
  );
}

export default function ProfilePage() {
  const navigate = useNavigate();
  const { user, reloadUser } = useAuth();

  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState({
    displayName: "",
    bio: "",
    avatarUrl: "",
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let active = true;

    async function loadProfile() {
      try {
        const data = await userApi.getMyProfile();

        if (!active) return;

        setProfile(data);
        setForm({
          displayName: data.displayName || "",
          bio: data.bio || "",
          avatarUrl: data.avatarUrl || "",
        });
      } catch (err) {
        if (active) {
          setError(getAuthError(err));
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadProfile();

    return () => {
      active = false;
    };
  }, []);

  function updateField(event) {
    const { name, value } = event.target;

    setForm((current) => ({
      ...current,
      [name]: value,
    }));

    setSuccess("");
  }

  async function handleSubmit(event) {
    event.preventDefault();

    setError("");
    setSuccess("");

    const displayName = form.displayName.trim();
    const bio = form.bio.trim();
    const avatarUrl = form.avatarUrl.trim();

    if (displayName.length < 2 || displayName.length > 100) {
      setError("Tên hiển thị phải có từ 2 đến 100 ký tự.");
      return;
    }

    if (bio.length > 500) {
      setError("Giới thiệu không được vượt quá 500 ký tự.");
      return;
    }

    if (avatarUrl) {
      try {
        const url = new URL(avatarUrl);

        if (!["http:", "https:"].includes(url.protocol)) {
          throw new Error("Invalid URL");
        }

        if (url.username || url.password) {
          throw new Error("Invalid URL");
        }
      } catch {
        setError("Ảnh đại diện phải là URL HTTP/HTTPS hợp lệ.");
        return;
      }
    }

    setSaving(true);

    try {
      const updated = await userApi.updateMyProfile({
        displayName,
        bio: bio || null,
        avatarUrl: avatarUrl || null,
      });

      setProfile(updated);
      setForm({
        displayName: updated.displayName,
        bio: updated.bio || "",
        avatarUrl: updated.avatarUrl || "",
      });

      try {
        // Đồng bộ tên và avatar với AuthContext/Messenger.
        await reloadUser();

        setSuccess("Cập nhật hồ sơ thành công.");
      } catch {
        setSuccess(
          "Hồ sơ đã lưu. Thông tin trên thanh điều hướng " +
          "sẽ đồng bộ khi tải lại trang."
        );
      }
    } catch (err) {
      setError(getAuthError(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="app-loading" role="status">
        <div className="loading-spinner" />
        <p>Đang tải hồ sơ...</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <main className="profile-page">
        <div className="profile-load-error">
          <h2>Không thể tải hồ sơ</h2>
          <p>{error || "Có lỗi xảy ra."}</p>
          <button
            type="button"
            onClick={() => navigate("/messenger")}
          >
            Quay lại Messenger
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="profile-page">
      <div className="profile-container">
        <header className="profile-topbar">
          <button
            type="button"
            className="profile-back-button"
            onClick={() => navigate("/messenger")}
          >
            <ArrowLeft size={20} />
            <span>Messenger</span>
          </button>

          <div className="profile-brand">
            <span className="profile-brand-icon">W</span>
            WebChat
          </div>
        </header>

        <div className="profile-heading">
          <div className="profile-heading-icon">
            <UserRound size={23} />
          </div>
          <div>
            <h1>Hồ sơ cá nhân</h1>
            <p>
              Quản lý thông tin hiển thị trên WebChat.
            </p>
          </div>
        </div>

        <div className="profile-layout">
          <aside className="profile-preview-card">
            <div className="profile-cover" />

            <div className="profile-preview-content">
              <div className="profile-avatar">
                <AvatarPreview
                  url={form.avatarUrl}
                  name={form.displayName || user?.displayName}
                />
              </div>

              <h2>{form.displayName || "Người dùng WebChat"}</h2>

              <p className="profile-handle">
                @{profile.username}
              </p>

              <p className="profile-bio">
                {form.bio || "Chưa có lời giới thiệu."}
              </p>

              <div className="profile-preview-separator" />

              <div className="profile-preview-detail">
                <span>Email</span>
                <strong>{profile.email}</strong>
              </div>

              <div className="profile-preview-detail">
                <span>Tham gia</span>
                <strong>
                  {new Date(
                    profile.createdAtUtc
                  ).toLocaleDateString("vi-VN")}
                </strong>
              </div>

              <p className="profile-preview-note">
                Đây là bản xem trước hồ sơ của bạn.
              </p>
            </div>
          </aside>

          <section className="profile-editor-card">
            <div className="profile-editor-header">
              <h2>Chỉnh sửa thông tin</h2>
              <p>
                Các thay đổi sẽ được lưu vào tài khoản WebChat.
              </p>
            </div>

            <form onSubmit={handleSubmit}>
              {error && (
                <div className="profile-alert error" role="alert">
                  {error}
                </div>
              )}

              {success && (
                <div className="profile-alert success" role="status">
                  <CheckCircle2 size={18} />
                  {success}
                </div>
              )}

              <div className="profile-field">
                <label htmlFor="profileDisplayName">
                  Tên hiển thị
                </label>

                <input
                  id="profileDisplayName"
                  name="displayName"
                  value={form.displayName}
                  onChange={updateField}
                  maxLength={100}
                  minLength={2}
                  required
                />

                <small>
                  Tên sẽ hiển thị cho những người trò chuyện cùng bạn.
                </small>
              </div>

              <div className="profile-field">
                <label htmlFor="profileBio">
                  Giới thiệu
                </label>

                <textarea
                  id="profileBio"
                  name="bio"
                  rows={4}
                  maxLength={500}
                  placeholder="Viết một chút về bản thân..."
                  value={form.bio}
                  onChange={updateField}
                />

                <div className="profile-field-footer">
                  <small>Tối đa 500 ký tự</small>
                  <small>{form.bio.length}/500</small>
                </div>
              </div>

              <div className="profile-field">
                <label htmlFor="profileAvatarUrl">
                  <Camera size={16} />
                  Link ảnh đại diện
                </label>

                <input
                  id="profileAvatarUrl"
                  name="avatarUrl"
                  type="url"
                  maxLength={2048}
                  placeholder="https://example.com/avatar.jpg"
                  value={form.avatarUrl}
                  onChange={updateField}
                />

                <small>
                  Hiện tại WebChat hỗ trợ link ảnh HTTPS/HTTP.
                  Chức năng tải ảnh lên sẽ được phát triển sau.
                </small>
              </div>

              <div className="profile-readonly-grid">
                <div className="profile-field">
                  <label htmlFor="profileUsername">
                    Username
                  </label>
                  <input
                    id="profileUsername"
                    value={profile.username}
                    readOnly
                  />
                </div>

                <div className="profile-field">
                  <label htmlFor="profileEmail">
                    Email
                  </label>
                  <input
                    id="profileEmail"
                    value={profile.email}
                    readOnly
                  />
                </div>
              </div>

              <div className="profile-form-actions">
                <button
                  type="button"
                  className="profile-cancel"
                  onClick={() => navigate("/messenger")}
                  disabled={saving}
                >
                  Quay lại
                </button>

                <button
                  type="submit"
                  className="profile-save"
                  disabled={saving}
                >
                  <Save size={17} />
                  {saving ? "Đang lưu..." : "Lưu thay đổi"}
                </button>
              </div>
            </form>
          </section>
        </div>
      </div>
    </main>
  );
}