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
  onUnavailable,
}) {
  if (!conversation) return null;

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

        <div
          className="chat-header-avatar"
          style={{
            backgroundColor: conversation.avatarColor,
            color: conversation.avatarTextColor,
          }}
        >
          {conversation.type === "group" ? (
            <Users size={22} />
          ) : (
            conversation.initials
          )}
        </div>

        <div className="chat-header-info">
          <h2>{conversation.name}</h2>

          <p>
            {conversation.type === "group"
              ? `${conversation.memberCount || 0} thành viên`
              : conversation.online
                ? "Đang hoạt động"
                : "Ngoại tuyến"}
          </p>
        </div>
      </div>

      <div className="chat-header-actions">
        <button
          type="button"
          title="Gọi thoại (sắp triển khai)"
          aria-label="Gọi thoại"
          onClick={() => onUnavailable("Gọi thoại")}
        >
          <Phone size={20} />
        </button>

        <button
          type="button"
          title="Gọi video (sắp triển khai)"
          aria-label="Gọi video"
          onClick={() => onUnavailable("Gọi video")}
        >
          <Video size={22} />
        </button>

        <button
          type="button"
          title="Thông tin cuộc trò chuyện"
          aria-label="Thông tin cuộc trò chuyện"
          onClick={() =>
            onUnavailable("Thông tin cuộc trò chuyện")
          }
        >
          <MoreHorizontal size={23} />
        </button>
      </div>
    </header>
  );
}