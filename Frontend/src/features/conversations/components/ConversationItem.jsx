
import { useState } from "react";
import { Users } from "lucide-react";

export default function ConversationItem({
  conversation,
  selected,
  onSelect,
}) {
  const [failedAvatar, setFailedAvatar] = useState(null);

  if (!conversation) return null;

  const avatarUrl = conversation.avatarUrl;

  const showAvatar =
    avatarUrl &&
    failedAvatar !== avatarUrl;

  const isGroup = conversation.type === "group";

  return (
    <button
      type="button"
      className={`conversation-item ${
        selected ? "is-selected" : ""
      }`}
      onClick={() => onSelect(conversation.id)}
      aria-current={selected ? "true" : undefined}
    >
      <div className="conversation-avatar-wrap">
        <div
          className="conversation-avatar"
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
              onError={() => setFailedAvatar(avatarUrl)}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                borderRadius: "50%",
              }}
            />
          ) : isGroup ? (
            <Users size={23} />
          ) : (
            conversation.initials || "?"
          )}
        </div>

        {/* Chỉ hiển thị online khi có dữ liệu thật */}
        {conversation.online === true &&
          !isGroup && (
            <span className="online-indicator" />
          )}
      </div>

      <div className="conversation-details">
        <div className="conversation-heading">
          <span className="conversation-name">
            {conversation.name}
          </span>

          <span className="conversation-time">
            {conversation.lastMessageTime || ""}
          </span>
        </div>

        <div className="conversation-preview-row">
          <span
            className={`conversation-preview ${
              conversation.unreadCount > 0
                ? "has-unread"
                : ""
            }`}
          >
            {conversation.canSendMessage === false
              ? "Chỉ đọc · Không thể gửi tin"
              : conversation.lastMessage ||
                "Chưa có tin nhắn"}
          </span>

          {conversation.unreadCount > 0 && (
            <span className="unread-badge">
              {conversation.unreadCount}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
