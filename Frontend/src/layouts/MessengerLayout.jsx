
import { useState } from "react";
import {
  Outlet,
  useLocation,
} from "react-router-dom";

import { X } from "lucide-react";

import { useAuth } from "../features/auth/hooks/useAuth";

import MessengerSidebar from "../features/conversations/components/MessengerSidebar";

import FriendRealtimeNotifications from "../features/friends/components/FriendRealtimeNotifications";

import "../styles/messenger.css";
import "../styles/messenger-layout.css";

export default function MessengerLayout() {
  const {
    user,
    logout,
    isLoggingOut,
  } = useAuth();

  const location = useLocation();

  const [notice, setNotice] = useState("");
  const [logoutError, setLogoutError] = useState("");

  const isMessenger =
    location.pathname === "/messenger" ||
    location.pathname.startsWith("/messenger/");

  // =====================================================
  // FEATURES NOT AVAILABLE YET
  // =====================================================

  function handleUnavailable(feature) {
    setNotice(
      `${feature} sẽ được triển khai ở bước tiếp theo.`
    );
  }

  // =====================================================
  // LOGOUT
  // =====================================================

  async function handleLogout() {
    setLogoutError("");

    try {
      await logout();
    } catch {
      setLogoutError(
        "Không thể đăng xuất trên máy chủ. Vui lòng thử lại."
      );
    }
  }

  // =====================================================
  // RENDER
  // =====================================================

  return (
    <div className="webchat-layout">
      <MessengerSidebar
        user={user}
        onLogout={handleLogout}
        isLoggingOut={isLoggingOut}
        onUnavailable={handleUnavailable}
      />

      <div
        className={`webchat-layout-content ${
          isMessenger
            ? "webchat-layout-chat"
            : ""
        }`}
      >
        <Outlet />
      </div>

      {/* =============================================
          5.7.8C - GLOBAL FRIEND NOTIFICATIONS
          ============================================= */}

      <FriendRealtimeNotifications />

      {/* =============================================
          EXISTING LAYOUT NOTIFICATIONS
          ============================================= */}

      {(notice || logoutError) && (
        <div
          className="messenger-toast webchat-layout-toast"
          role={
            logoutError ? "alert" : "status"
          }
        >
          <span>
            {logoutError || notice}
          </span>

          <button
            type="button"
            onClick={() => {
              setNotice("");
              setLogoutError("");
            }}
            aria-label="Đóng thông báo"
          >
            <X size={17} />
          </button>
        </div>
      )}
    </div>
  );
}
