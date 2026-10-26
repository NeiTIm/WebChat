
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { useParams } from "react-router-dom";

import {
  ImagePlus,
  LoaderCircle,
  Paperclip,
  Send,
  Smile,
} from "lucide-react";

import { useAuth } from "../../auth/hooks/useAuth";
import { useChatRealtime } from "../../realtime/hooks/useChatRealtime";

const MAX_LENGTH = 4000;
const TYPING_THROTTLE_MS = 2000;
const TYPING_IDLE_MS = 2500;
const REMOTE_TTL_MS = 5500;

function normalizeId(value) {
  return String(value ?? "").toLowerCase();
}

function getConnectionKey(payload) {
  if (!payload?.userId || !payload?.connectionId) {
    return null;
  }

  return (
    normalizeId(payload.userId) +
    ":" +
    String(payload.connectionId)
  );
}

function getRemoteTypingLabel(users, fallbackName) {
  const names = [...users.values()].map(
    (name) => name || fallbackName || "Một người"
  );

  if (names.length === 0) {
    return "";
  }

  if (names.length === 1) {
    return `${names[0]} đang soạn tin nhắn...`;
  }

  if (names.length === 2) {
    return `${names[0]} và ${names[1]} đang nhập...`;
  }

  return `${names.length} người đang nhập...`;
}

export default function MessageInput({
  onSend,
  onUnavailable = () => {},
  disabled = false,
  sending = false,
  placeholder = "Nhập tin nhắn...",

  // Có thể truyền trực tiếp từ ConversationMessagesPanel.
  conversationId: conversationIdProp,
  otherName = "Người đối diện",
}) {
  const params = useParams();

  const conversationId =
    conversationIdProp || params.conversationId;

  const { user } = useAuth();

  const currentUserId =
    user?.id || user?.userId || null;

  const {
    subscribe,
    isConnected,
    startTyping,
    stopTyping,
  } = useChatRealtime();

  const [text, setText] = useState("");

  const [localTyping, setLocalTyping] =
    useState(false);

  const [remoteUsers, setRemoteUsers] =
    useState(new Map());

  const textareaRef = useRef(null);

  const localTypingRef = useRef(false);
  const lastStartRef = useRef(0);
  const idleTimerRef = useRef(null);

  // Map<connectionKey, { userId, displayName, expiresAt }>
  const remoteConnectionsRef = useRef(new Map());

  const content = text.trim();

  const canSend =
    !disabled &&
    !sending &&
    content.length > 0 &&
    content.length <= MAX_LENGTH;

  // =====================================================
  // STOP LOCAL TYPING
  // =====================================================

  const stopLocal = useCallback(() => {
    if (idleTimerRef.current !== null) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }

    const wasTyping = localTypingRef.current;

    localTypingRef.current = false;
    lastStartRef.current = 0;

    setLocalTyping(false);

    if (
      wasTyping &&
      conversationId &&
      isConnected
    ) {
      void stopTyping(conversationId);
    }
  }, [
    conversationId,
    isConnected,
    stopTyping,
  ]);

  // =====================================================
  // LOCAL TYPING
  // =====================================================

  const notifyTyping = useCallback(
    (value) => {
      if (
        disabled ||
        !conversationId ||
        !value.trim()
      ) {
        stopLocal();
        return;
      }

      // A nhìn thấy trạng thái của chính mình
      // ngay lập tức, không đợi Backend ACK.
      localTypingRef.current = true;
      setLocalTyping(true);

      const now = Date.now();

      if (
        isConnected &&
        (
          lastStartRef.current === 0 ||
          now - lastStartRef.current >=
            TYPING_THROTTLE_MS
        )
      ) {
        lastStartRef.current = now;

        void startTyping(conversationId).then(
          (accepted) => {
            if (!accepted && import.meta.env.DEV) {
              console.warn(
                "[WebChat Typing] Backend không xác nhận StartTyping.",
                { conversationId }
              );
            }
          }
        );
      }

      if (idleTimerRef.current !== null) {
        clearTimeout(idleTimerRef.current);
      }

      idleTimerRef.current = setTimeout(() => {
        idleTimerRef.current = null;
        stopLocal();
      }, TYPING_IDLE_MS);
    },
    [
      conversationId,
      disabled,
      isConnected,
      startTyping,
      stopLocal,
    ]
  );

  function handleChange(event) {
    const value = event.target.value;

    setText(value);
    notifyTyping(value);
  }

  // =====================================================
  // RECEIVE REMOTE TYPING EVENTS
  // =====================================================

  useEffect(() => {
    if (!conversationId || !isConnected) {
      return undefined;
    }

    const connections =
      remoteConnectionsRef.current;

    function refreshRemoteUsers() {
      const now = Date.now();

      for (const [key, entry] of connections) {
        if (entry.expiresAt <= now) {
          connections.delete(key);
        }
      }

      // Gom theo UserId để cùng một người mở
      // nhiều tab vẫn chỉ xuất hiện một lần.
      const users = new Map();

      for (const entry of connections.values()) {
        users.set(
          normalizeId(entry.userId),
          entry.displayName
        );
      }

      setRemoteUsers(users);
    }

    function belongsToThisConversation(payload) {
      if (
        normalizeId(payload?.conversationId) !==
        normalizeId(conversationId)
      ) {
        return false;
      }

      if (!payload?.userId) {
        return false;
      }

      // Trạng thái của chính A đã có localTyping.
      // Không hiện A hai lần từ SignalR.
      if (
        normalizeId(payload.userId) ===
        normalizeId(currentUserId)
      ) {
        return false;
      }

      return true;
    }

    function handleTypingStarted(payload) {
      if (!belongsToThisConversation(payload)) {
        return;
      }

      const key = getConnectionKey(payload);

      if (!key) return;

      const name =
        typeof payload.displayName === "string" &&
        payload.displayName.trim()
          ? payload.displayName.trim()
          : otherName;

      connections.set(key, {
        userId: payload.userId,
        displayName: name,
        expiresAt: Date.now() + REMOTE_TTL_MS,
      });

      refreshRemoteUsers();
    }

    function handleTypingStopped(payload) {
      if (!belongsToThisConversation(payload)) {
        return;
      }

      const key = getConnectionKey(payload);

      if (!key) return;

      connections.delete(key);
      refreshRemoteUsers();
    }

    const unsubscribeStart = subscribe(
      "TypingStarted",
      handleTypingStarted
    );

    const unsubscribeStop = subscribe(
      "TypingStopped",
      handleTypingStopped
    );

    const interval = setInterval(
      refreshRemoteUsers,
      500
    );

    return () => {
      unsubscribeStart();
      unsubscribeStop();

      clearInterval(interval);

      connections.clear();
    };
  }, [
    conversationId,
    currentUserId,
    isConnected,
    otherName,
    subscribe,
  ]);

  // =====================================================
  // STOP WHEN DISABLED
  // =====================================================

  useEffect(() => {
    if (disabled || !isConnected) {
      // Không giữ trạng thái local typing khi
      // quyền gửi hoặc kết nối không khả dụng.
      // Reset ở handler thay đổi và cleanup.
      localTypingRef.current = false;
    }
  }, [disabled, isConnected]);

  // =====================================================
  // CLEANUP ON CONVERSATION CHANGE / UNMOUNT
  // =====================================================

  useEffect(() => {
    const activeConversationId = conversationId;

    return () => {
      if (idleTimerRef.current !== null) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }

      if (localTypingRef.current) {
        localTypingRef.current = false;

        if (activeConversationId) {
          void stopTyping(activeConversationId);
        }
      }

      lastStartRef.current = 0;
    };
  }, [conversationId, stopTyping]);

  // =====================================================
  // SEND MESSAGE
  // =====================================================

  function submit(event) {
    event.preventDefault();

    if (!canSend || typeof onSend !== "function") {
      return;
    }

    stopLocal();

    // Phần gửi SignalR và Retry nằm ở Parent.
    onSend(content);

    setText("");

    // Giữ focus sau khi gửi.
    textareaRef.current?.focus();
  }

  function handleKeyDown(event) {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing &&
      event.keyCode !== 229
    ) {
      event.preventDefault();

      if (canSend) {
        event.currentTarget.form?.requestSubmit();
      }
    }
  }

  const remoteTypingLabel = getRemoteTypingLabel(
    remoteUsers,
    otherName
  );

  return (
    <div className="webchat-composer-container">
      {/* TYPING STATUS */}
      {(localTyping && !disabled ||
        isConnected && remoteUsers.size > 0) && (
        <div
          className="webchat-typing-indicator"
          role="status"
          aria-live="polite"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 3,
            padding: "5px 15px",
            fontSize: 12,
            fontStyle: "italic",
            color: "var(--text-secondary, #64748b)",
          }}
        >
          {localTyping && !disabled && (
            <span>✏️ Bạn đang nhập...</span>
          )}

          {isConnected && remoteUsers.size > 0 && (
            <span>
              <span aria-hidden="true">● ● ● </span>
              {remoteTypingLabel}
            </span>
          )}
        </div>
      )}

      {/* MESSAGE COMPOSER */}
      <form
        className="message-composer"
        onSubmit={submit}
        aria-label="Soạn tin nhắn"
      >
        <div className="composer-tools">
          <button
            type="button"
            title="Đính kèm file (chưa triển khai)"
            aria-label="Đính kèm file"
            disabled={disabled}
            onClick={() =>
              onUnavailable("Đính kèm file")
            }
          >
            <Paperclip size={20} />
          </button>

          <button
            type="button"
            title="Gửi hình ảnh (chưa triển khai)"
            aria-label="Gửi hình ảnh"
            disabled={disabled}
            onClick={() =>
              onUnavailable("Gửi hình ảnh")
            }
          >
            <ImagePlus size={21} />
          </button>
        </div>

        <div className="composer-input-wrap">
          <textarea
            ref={textareaRef}
            rows={1}
            maxLength={MAX_LENGTH}
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onBlur={stopLocal}
            placeholder={
              disabled
                ? "Không thể soạn tin nhắn lúc này..."
                : placeholder
            }
            aria-label="Nội dung tin nhắn"
            disabled={disabled}
          />

          <button
            type="button"
            className="composer-emoji"
            title="Emoji (chưa triển khai)"
            aria-label="Emoji"
            disabled={disabled}
            onClick={() =>
              onUnavailable("Emoji")
            }
          >
            <Smile size={20} />
          </button>
        </div>

        <button
          type="submit"
          className="composer-send"
          disabled={!canSend}
          title={
            sending
              ? "Đang gửi tin nhắn"
              : "Gửi tin nhắn"
          }
          aria-label="Gửi tin nhắn"
          aria-busy={sending}
        >
          {sending ? (
            <LoaderCircle
              size={19}
              className="webchat-spin"
            />
          ) : (
            <Send size={19} />
          )}
        </button>
      </form>
    </div>
  );
}
