import {
  MessageCircle,
  Settings,
  Users,
  LogOut,
  MessageSquare,
} from "lucide-react";

import { useNavigate } from "react-router-dom";

export default function MessengerSidebar({
  user,
  onLogout,
  isLoggingOut,
  onUnavailable,
}) {
  const navigate = useNavigate();

  const initials = (user?.displayName || user?.username || "U")
    .trim()
    .split(/\s+/)
    .slice(-2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");

  return (
    <aside className="messenger-sidebar">
      <div className="sidebar-top">
        <div className="sidebar-brand" title="WebChat">
          <MessageCircle size={25} />
        </div>

        <nav
          className="sidebar-navigation"
          aria-label="Điều hướng chính"
        >
          <button
            type="button"
            className="sidebar-icon is-active"
            aria-label="Tin nhắn"
            aria-current="page"
            title="Tin nhắn"
          >
            <MessageSquare size={22} />
          </button>

          <button
            type="button"
            className="sidebar-icon"
            onClick={() => onUnavailable("Danh bạ bạn bè")}
            aria-label="Bạn bè"
            title="Bạn bè"
          >
            <Users size={22} />
          </button>

          <button
            type="button"
            className="sidebar-icon"
            onClick={() => onUnavailable("Cài đặt")}
            aria-label="Cài đặt"
            title="Cài đặt"
          >
            <Settings size={22} />
          </button>
        </nav>
      </div>

      <div className="sidebar-bottom">
        <button
          type="button"
          className="sidebar-icon"
          title="Đăng xuất"
          aria-label="Đăng xuất"
          disabled={isLoggingOut}
          onClick={onLogout}
        >
          <LogOut size={21} />
        </button>

        <button
          type="button"
          className="sidebar-profile-button"
          onClick={() => navigate("/profile")}
          title="Xem và chỉnh sửa hồ sơ"
          aria-label="Hồ sơ cá nhân"
        >
          {user?.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt=""
              referrerPolicy="no-referrer"
              onError={(event) => {
                event.currentTarget.style.display = "none";
              }}
            />
          ) : null}

          <span>{initials}</span>
        </button>
      </div>
    </aside>
  );
}