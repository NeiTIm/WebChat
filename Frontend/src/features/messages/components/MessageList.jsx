
import {
  useCallback,
  useLayoutEffect,
  useRef,
} from "react";

const LOAD_THRESHOLD = 120;

function formatMessageDate(value) {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

export default function MessageList({
  messages = [],
  conversation,
  hasMore = false,
  loadingOlder = false,
  onLoadOlder,
}) {
  const listRef = useRef(null);

  const initializedRef = useRef(false);

  // Lưu tọa độ trước khi tải tin cũ.
  const prependSnapshotRef = useRef(null);

  // Ghi nhận người dùng đang ở gần cuối hay không.
  const nearBottomRef = useRef(true);

  const loadingRequestRef = useRef(false);

  const previousMessagesRef = useRef({
    count: 0,
    firstId: null,
    lastId: null,
  });

  // =====================================================
  // LOAD OLDER
  // =====================================================

  const loadOlder = useCallback(async () => {
    const element = listRef.current;

    if (
      !element ||
      !hasMore ||
      loadingOlder ||
      loadingRequestRef.current ||
      typeof onLoadOlder !== "function"
    ) {
      return;
    }

    loadingRequestRef.current = true;

    prependSnapshotRef.current = {
      height: element.scrollHeight,
      top: element.scrollTop,
      firstId: messages[0]?.id ?? null,
    };

    try {
      const loaded = await onLoadOlder();

      if (!loaded) {
        prependSnapshotRef.current = null;
      }
    } catch {
      prependSnapshotRef.current = null;
    } finally {
      loadingRequestRef.current = false;
    }
  }, [hasMore, loadingOlder, messages, onLoadOlder]);

  // =====================================================
  // SCROLL HANDLER
  // =====================================================

  function handleScroll(event) {
    const element = event.currentTarget;

    const distanceFromBottom =
      element.scrollHeight -
      element.scrollTop -
      element.clientHeight;

    nearBottomRef.current =
      distanceFromBottom <= 120;

    if (
      element.scrollTop <= LOAD_THRESHOLD &&
      hasMore &&
      !loadingOlder
    ) {
      void loadOlder();
    }
  }

  // =====================================================
  // RESTORE SCROLL / AUTO SCROLL
  // =====================================================

  useLayoutEffect(() => {
    const element = listRef.current;

    if (!element) return;

    const firstId = messages[0]?.id ?? null;
    const lastId = messages.at(-1)?.id ?? null;

    const previous = previousMessagesRef.current;

    const snapshot = prependSnapshotRef.current;

    if (
      snapshot &&
      firstId !== snapshot.firstId
    ) {
      // DOM đã thêm tin cũ ở phía trên.
      // Bù lại phần chiều cao vừa được thêm.
      const heightDifference =
        element.scrollHeight - snapshot.height;

      element.scrollTop =
        snapshot.top + heightDifference;

      prependSnapshotRef.current = null;

      previousMessagesRef.current = {
        count: messages.length,
        firstId,
        lastId,
      };

      return;
    }

    if (!initializedRef.current) {
      // Lần tải đầu tiên: mở ở cuối cuộc trò chuyện.
      element.scrollTop = element.scrollHeight;
      initializedRef.current = true;
    } else if (!snapshot) {
      const newLastMessage =
        lastId !== previous.lastId;

      const lastMessage = messages.at(-1);

      if (
        newLastMessage &&
        (
          nearBottomRef.current ||
          lastMessage?.sender === "me"
        )
      ) {
        element.scrollTop = element.scrollHeight;
      }
    }

    previousMessagesRef.current = {
      count: messages.length,
      firstId,
      lastId,
    };
  }, [messages]);

  if (!conversation) return null;

  return (
    <div
      ref={listRef}
      className="message-list"
      role="log"
      aria-label={`Tin nhắn trong ${
        conversation.name || "cuộc trò chuyện"
      }`}
      aria-live="polite"
      onScroll={handleScroll}
      style={{
        flex: "1 1 0",
        minHeight: 0,
        overflowY: "auto",
        overflowX: "hidden",
        overflowAnchor: "none",
      }}
    >
      {/* LOAD OLDER */}
      {hasMore && (
        <div
          style={{
            textAlign: "center",
            padding: "12px 16px",
          }}
        >
          <button
            type="button"
            disabled={loadingOlder}
            onClick={() => void loadOlder()}
            style={{
              padding: "8px 14px",
              borderRadius: 10,
              cursor: loadingOlder
                ? "wait"
                : "pointer",
            }}
          >
            {loadingOlder
              ? "Đang tải tin nhắn cũ..."
              : "Tải tin nhắn cũ"}
          </button>
        </div>
      )}

      {/* CONVERSATION INTRO */}
      <div className="chat-introduction">
        <div
          className="chat-intro-avatar"
          style={{
            backgroundColor:
              conversation.avatarColor || "#e6efff",
            color:
              conversation.avatarTextColor || "#2563eb",
          }}
        >
          {conversation.initials || "?"}
        </div>

        <h3>{conversation.name}</h3>

        <p>
          Đây là cuộc trò chuyện riêng tư giữa
          bạn và {conversation.name}.
        </p>
      </div>

      {/* EMPTY */}
      {messages.length === 0 && (
        <div
          className="conversation-empty"
          style={{
            padding: 20,
            textAlign: "center",
          }}
        >
          Chưa có tin nhắn nào.
          Hãy bắt đầu cuộc trò chuyện!
        </div>
      )}

      {/* MESSAGE ITEMS */}
      {messages.map((message, index) => {
        const isMine = message.sender === "me";

        const previousMessage =
          index > 0 ? messages[index - 1] : null;

        const currentDate = formatMessageDate(
          message.createdAtUtc
        );

        const previousDate = previousMessage
          ? formatMessageDate(
              previousMessage.createdAtUtc
            )
          : null;

        const showDate =
          currentDate &&
          currentDate !== previousDate;

        const recalled = Boolean(
          message.recalledAtUtc
        );

        return (
          <div key={message.id}>
            {showDate && (
              <div className="message-date-divider">
                <span>{currentDate}</span>
              </div>
            )}

            <div
              className={`message-row ${
                isMine
                  ? "message-mine"
                  : "message-other"
              }`}
            >
              <div className="message-content-wrapper">
                {!isMine && message.senderName && (
                  <span className="message-sender-name">
                    {message.senderName}
                  </span>
                )}

                <div
                  className="message-bubble"
                  style={{
                    whiteSpace: "pre-wrap",
                    overflowWrap: "anywhere",
                    fontStyle: recalled
                      ? "italic"
                      : "normal",
                  }}
                >
                  {recalled
                    ? "Tin nhắn đã được thu hồi"
                    : message.content}
                </div>

                <span className="message-timestamp">
                  {message.time}

                  {message.editedAtUtc &&
                    !recalled &&
                    " · Đã chỉnh sửa"}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
