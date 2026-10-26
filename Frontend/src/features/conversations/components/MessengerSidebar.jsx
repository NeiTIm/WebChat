import {
  MessageCircle,
  Settings,
  Users,
  LogOut,
  MessageSquare,
  Search,
} from "lucide-react";

import {
  useLocation,
  useNavigate,
} from "react-router-dom";

export default function MessengerSidebar({
  user,
  onLogout,
  isLoggingOut,
  onUnavailable,
}) {
  const navigate = useNavigate();
  const location = useLocation();

  const pathname = location.pathname;

  const isMessenger =
    pathname === "/messenger" ||
    pathname.startsWith("/messenger/");

  const isFriends = pathname === "/friends";
  const isSearch = pathname === "/users/search";
  const isProfile = pathname === "/profile";

  const initials = (
    user?.displayName ||
    user?.username ||
    "U"
  )
    .trim()
    .split(/\s+/)
    .slice(-2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");

  return (
    <aside className="messenger-sidebar">
      <div className="sidebar-top">
        <div
          className="sidebar-brand"
          title="WebChat"
        >
          <MessageCircle size={25} />
        </div>

        <nav
          className="sidebar-navigation"
          aria-label="Điều hướng chính"
        >
          {/* MESSENGER */}
          <button
            type="button"
            className={`sidebar-icon ${
              isMessenger ? "is-active" : ""
            }`}
            onClick={() => navigate("/messenger")}
            aria-label="Tin nhắn"
            aria-current={
              isMessenger ? "page" : undefined
            }
            title="Tin nhắn"
          >
            <MessageSquare size={22} />
          </button>

          {/* FRIENDS */}
          <button
            type="button"
            className={`sidebar-icon ${
              isFriends ? "is-active" : ""
            }`}
            onClick={() => navigate("/friends")}
            aria-label="Bạn bè"
            aria-current={
              isFriends ? "page" : undefined
            }
            title="Bạn bè"
          >
            <Users size={22} />
          </button>

          {/* USER SEARCH */}
          <button
            type="button"
            className={`sidebar-icon ${
              isSearch ? "is-active" : ""
            }`}
            onClick={() => navigate("/users/search")}
            aria-label="Tìm kiếm người dùng"
            aria-current={
              isSearch ? "page" : undefined
            }
            title="Tìm kiếm người dùng"
          >
            <Search size={22} />
          </button>

          {/* SETTINGS - CHƯA TRIỂN KHAI */}
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
        {/* LOGOUT */}
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

        {/* PROFILE */}
        <button
          type="button"
          className={`sidebar-profile-button ${
            isProfile ? "is-active" : ""
          }`}
          onClick={() => navigate("/profile")}
          title="Hồ sơ cá nhân"
          aria-label="Hồ sơ cá nhân"
          aria-current={
            isProfile ? "page" : undefined
          }
        >
          {user?.avatarUrl ? (
            <img
              key={user.avatarUrl}
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