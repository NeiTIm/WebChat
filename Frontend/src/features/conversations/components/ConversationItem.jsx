import { Users } from "lucide-react";

export default function ConversationItem({
  conversation,
  selected,
  onSelect,
}) {
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
            backgroundColor: conversation.avatarColor,
            color: conversation.avatarTextColor,
          }}
        >
          {conversation.type === "group" ? (
            <Users size={23} />
          ) : (
            conversation.initials
          )}
        </div>

        {conversation.online &&
          conversation.type === "private" && (
            <span className="online-indicator" />
          )}
      </div>

      <div className="conversation-details">
        <div className="conversation-heading">
          <span className="conversation-name">
            {conversation.name}
          </span>

          <span className="conversation-time">
            {conversation.lastMessageTime}
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
            {conversation.lastMessage}
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