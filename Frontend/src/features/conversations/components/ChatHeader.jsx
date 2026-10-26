
import { useState } from "react";

import {
  ArrowLeft,
  MoreHorizontal,
  Phone,
  Video,
  Users,
} from "lucide-react";

export default function ChatHeader({
  conversation,
  onBack,
  onUnavailable = () => {},
}) {
  const [failedAvatar, setFailedAvatar] = useState(null);

  if (!conversation) return null;

  const isGroup = conversation.type === "group";

  const avatarUrl = conversation.avatarUrl;

  const showAvatar =
    avatarUrl &&
    failedAvatar !== avatarUrl;

  // =====================================================
  // PRESENCE
  // =====================================================

  const isOnline = conversation.online === true;
  const isOffline = conversation.online === false;

  const canShowPresence =
    !isGroup &&
    conversation.canSendMessage !== false;

  function getStatusText() {
    if (isGroup) {
      return `${conversation.memberCount || 0} thành viên`;
    }

    if (conversation.canSendMessage === false) {
      return (
        conversation.cannotSendReason ||
        "Không thể gửi tin nhắn"
      );
    }

    if (isOnline) {
      return "Đang hoạt động";
    }

    if (isOffline) {
      return "Ngoại tuyến";
    }

    return "Cuộc trò chuyện riêng tư";
  }

  // =====================================================
  // RENDER
  // =====================================================

  return (
    <header className="chat-header">
      <div className="chat-header-identity">
        <button
          type="button"
          className="chat-back-button"
          onClick={onBack}
          aria-label="Quay về danh sách chat"
        >
          <ArrowLeft size={22} />
        </button>

        {/* AVATAR + ONLINE DOT */}
        <div
          style={{
            position: "relative",
            flexShrink: 0,
          }}
        >
          <div
            className="chat-header-avatar"
            style={{
              backgroundColor:
                conversation.avatarColor || "#e6efff",
              color:
                conversation.avatarTextColor || "#2563eb",
              overflow: "hidden",
            }}
          >
            {showAvatar ? (
              <img
                src={avatarUrl}
                alt=""
                referrerPolicy="no-referrer"
                onError={() =>
                  setFailedAvatar(avatarUrl)
                }
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  borderRadius: "50%",
                }}
              />
            ) : isGroup ? (
              <Users size={22} />
            ) : (
              conversation.initials || "?"
            )}
          </div>

          {canShowPresence && isOnline && (
            <span
              aria-label="Đang hoạt động"
              title="Đang hoạt động"
              style={{
                position: "absolute",
                right: 0,
                bottom: 0,
                width: 12,
                height: 12,
                borderRadius: "50%",
                backgroundColor: "#22c55e",
                border: "2px solid var(--surface, #ffffff)",
                boxSizing: "content-box",
              }}
            />
          )}
        </div>

        {/* NAME + STATUS */}
        <div className="chat-header-info">
          <h2>{conversation.name}</h2>

          <p
            style={{
              color:
                canShowPresence && isOnline
                  ? "#16a34a"
                  : undefined,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {canShowPresence && isOnline && (
              <span
                aria-hidden="true"
                style={{
                  width: 7,
                  height: 7,
                  flexShrink: 0,
                  borderRadius: "50%",
                  backgroundColor: "#22c55e",
                }}
              />
            )}

            {getStatusText()}
          </p>
        </div>
      </div>

      {/* ACTIONS */}
      <div className="chat-header-actions">
        <button
          type="button"
          title="Gọi thoại (sắp triển khai)"
          aria-label="Gọi thoại"
          onClick={() =>
            onUnavailable("Gọi thoại")
          }
        >
          <Phone size={20} />
        </button>

        <button
          type="button"
          title="Gọi video (sắp triển khai)"
          aria-label="Gọi video"
          onClick={() =>
            onUnavailable("Gọi video")
          }
        >
          <Video size={22} />
        </button>

        <button
          type="button"
          title="Thông tin cuộc trò chuyện"
          aria-label="Thông tin cuộc trò chuyện"
          onClick={() =>
            onUnavailable(
              "Thông tin cuộc trò chuyện"
            )
          }
        >
          <MoreHorizontal size={23} />
        </button>
      </div>
    </header>
  );
}
