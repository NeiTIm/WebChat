
import { useCallback, useEffect, useRef, useState } from "react";
import { Users } from "lucide-react";

function normalizeId(value) {
  return String(value || "").toLowerCase();
}

export default function ConversationItem({
  conversation,
  selected,
  onSelect,

  // PHASE 5.8E3
  onPreviewSeen,
  currentUserId,
}) {
  const [failedAvatar, setFailedAvatar] = useState(null);

  const previewRef = useRef(null);
  const visibleRef = useRef(false);

  const id = conversation?.id;
  const lastMessageSequence =
    conversation?.lastMessageSequence;

  const lastMessagePreviewSequence =
    conversation?.lastMessagePreviewSequence;

  const lastMessageContent =
    conversation?.lastMessageContent;

  const lastMessageSenderId =
    conversation?.lastMessageSenderId;

  const lastReadSequence =
    conversation?.lastReadSequence ?? 0;

  const canConfirmPreview =
    Boolean(id) &&
    Number.isSafeInteger(lastMessageSequence) &&
    lastMessageSequence > 0 &&
    lastMessagePreviewSequence === lastMessageSequence &&
    typeof lastMessageContent === "string" &&
    lastMessageContent.trim().length > 0 &&
    Boolean(lastMessageSenderId) &&
    normalizeId(lastMessageSenderId) !==
      normalizeId(currentUserId) &&
    Boolean(currentUserId) &&
    lastMessageSequence > lastReadSequence;

  const tryConfirmPreview = useCallback(() => {
    if (!canConfirmPreview) return;
    if (!visibleRef.current) return;

    if (
      document.visibilityState !== "visible" ||
      !document.hasFocus()
    ) {
      return;
    }

    onPreviewSeen?.(
      id,
      lastMessageSequence
    );
  }, [
    canConfirmPreview,
    id,
    lastMessageSequence,
    onPreviewSeen,
  ]);

  // =====================================================
  // PHASE 5.8E3 - PREVIEW VISIBILITY
  // =====================================================

  useEffect(() => {
    visibleRef.current = false;

    const element = previewRef.current;

    if (!element || !canConfirmPreview) {
      return undefined;
    }

    if (typeof IntersectionObserver === "undefined") {
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];

        visibleRef.current =
          Boolean(entry?.isIntersecting) &&
          entry.intersectionRatio >= 0.9;

        if (visibleRef.current) {
          tryConfirmPreview();
        }
      },
      {
        threshold: [0, 0.9, 1],
      }
    );

    observer.observe(element);

    // Khi quay lại tab đang mở Messenger,
    // thử xác nhận lại preview đang hiển thị.
    const handleVisibilityChange = () => {
      tryConfirmPreview();
    };

    const handleWindowFocus = () => {
      tryConfirmPreview();
    };

    document.addEventListener(
      "visibilitychange",
      handleVisibilityChange
    );

    window.addEventListener(
      "focus",
      handleWindowFocus
    );

    return () => {
      observer.disconnect();

      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange
      );

      window.removeEventListener(
        "focus",
        handleWindowFocus
      );

      visibleRef.current = false;
    };
  }, [canConfirmPreview, tryConfirmPreview]);

  if (!conversation) return null;

  const avatarUrl = conversation.avatarUrl;

  const showAvatar =
    avatarUrl &&
    failedAvatar !== avatarUrl;

  const isGroup =
    conversation.type === "group";

  // Chỉ hiển thị preview đã khớp sequence.
  const hasValidPreview =
    typeof lastMessageContent === "string" &&
    lastMessagePreviewSequence ===
      lastMessageSequence;

  const previewText =
    conversation.canSendMessage === false
      ? "Chỉ đọc · Không thể gửi tin"
      : hasValidPreview
        ? lastMessageContent || "Tin nhắn trống"
        : conversation.lastMessageSequence > 0
          ? "Đang cập nhật tin nhắn..."
          : "Chưa có tin nhắn";

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
            <Users size={23} />
          ) : (
            conversation.initials || "?"
          )}
        </div>

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
            ref={previewRef}
            className={`conversation-preview ${
              conversation.unreadCount > 0
                ? "has-unread"
                : ""
            }`}
          >
            {previewText}
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
