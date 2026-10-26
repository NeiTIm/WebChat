
import {
  useEffect,
  useRef,
} from "react";

import { markAsRead } from "../api/readApi";

// =====================================================
// PHASE 5.8E3 - READ SYNC
// =====================================================

const BOTTOM_THRESHOLD = 60;
const INITIAL_CHECK_DELAY_MS = 100;

function normalizeId(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function validSequence(value) {
  return (
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function isCanceled(error, signal) {
  return (
    signal?.aborted ||
    error?.code === "ERR_CANCELED" ||
    error?.name === "AbortError"
  );
}

function isAtBottom(element) {
  if (!element) return false;

  const remaining =
    element.scrollHeight -
    element.scrollTop -
    element.clientHeight;

  return remaining <= BOTTOM_THRESHOLD;
}

function isVisible(element) {
  if (!element || !element.isConnected) {
    return false;
  }

  if (
    document.visibilityState !== "visible" ||
    !document.hasFocus()
  ) {
    return false;
  }

  const rect = element.getBoundingClientRect();

  if (
    rect.width <= 0 ||
    rect.height <= 0
  ) {
    return false;
  }

  return (
    rect.bottom > 0 &&
    rect.top < window.innerHeight
  );
}

/**
 * Chỉ chạy khi:
 * 1. MessagePanel của conversation đang được mount.
 * 2. Lịch sử mới nhất đã tải.
 * 3. MessageList đang hiển thị và ở cuối.
 * 4. Tab đang visible và có focus.
 * 5. Có tin của người khác chưa được đánh dấu đọc.
 *
 * Không dùng presence hoặc online status
 * để suy ra rằng tin đã được đọc.
 */
export default function MessageReadSync({
  conversationId,
  currentUserId,
  lastMessageSequence,
  myLastReadSequence,
  messages,
  loading,
  onReadConfirmed,
}) {
  const lastAckRef = useRef(0);
  const inFlightRef = useRef(null);
  const sessionRef = useRef(null);
  const refreshRef = useRef(onReadConfirmed);

  // Giữ callback mới nhất nhưng không khởi động
  // lại request chỉ vì parent render.
  useEffect(() => {
    refreshRef.current = onReadConfirmed;
  }, [onReadConfirmed]);

  const latestLoadedSequence =
    Array.isArray(messages)
      ? messages.reduce((max, message) => {
          const sequence =
            message?.sequenceNumber;

          return (
            Number.isSafeInteger(sequence) &&
            sequence > max
          )
            ? sequence
            : max;
        }, 0)
      : 0;

  const serverReadSequence =
    validSequence(myLastReadSequence)
      ? myLastReadSequence
      : null;

  const lastIncomingSequence =
    Array.isArray(messages)
      ? messages.reduce((max, message) => {
          if (
            !message?.id ||
            normalizeId(message.senderId) ===
              normalizeId(currentUserId)
          ) {
            return max;
          }

          const sequence =
            message.sequenceNumber;

          return (
            Number.isSafeInteger(sequence) &&
            sequence > max
          )
            ? sequence
            : max;
        }, 0)
      : 0;

  // =====================================================
  // CONVERSATION SESSION RESET
  // =====================================================

  useEffect(() => {
    const sessionKey = [
      normalizeId(currentUserId),
      normalizeId(conversationId),
    ].join(":");

    if (sessionRef.current !== sessionKey) {
      inFlightRef.current?.controller.abort();

      inFlightRef.current = null;
      lastAckRef.current = 0;
      sessionRef.current = sessionKey;
    }

    return () => {
      inFlightRef.current?.controller.abort();
      inFlightRef.current = null;
    };
  }, [
    currentUserId,
    conversationId,
  ]);

  // =====================================================
  // READ ONLY WHEN ACTUALLY VIEWING
  // =====================================================

  useEffect(() => {
    if (
      loading ||
      !conversationId ||
      !currentUserId ||
      !validSequence(lastMessageSequence) ||
      lastMessageSequence <= 0 ||
      serverReadSequence === null ||
      latestLoadedSequence !==
        lastMessageSequence
    ) {
      return undefined;
    }

    let active = true;
    let timer = null;

    // Cập nhật tới sequence mới nhất đang hiển thị.
    // Nếu cursor server đã lớn hơn thì không
    // thực hiện thao tác giảm cursor.
    const target = lastMessageSequence;

    function getEffectiveReadSequence() {
      return Math.max(
        serverReadSequence,
        lastAckRef.current
      );
    }

    async function tryMarkAsRead() {
      if (!active) return;

      const list = document.querySelector(
        ".message-list"
      );

      if (
        !isVisible(list) ||
        !isAtBottom(list)
      ) {
        return;
      }

      // Không gửi request nếu không có tin
      // của đối phương cần xác nhận đã đọc.
      if (
        lastIncomingSequence <=
          getEffectiveReadSequence()
      ) {
        return;
      }

      if (
        target <= getEffectiveReadSequence()
      ) {
        return;
      }

      // Không gửi hai request cạnh tranh.
      if (inFlightRef.current) {
        return;
      }

      const controller = new AbortController();

      const request = {
        controller,
        target,
      };

      inFlightRef.current = request;

      try {
        const result = await markAsRead(
          conversationId,
          target,
          { signal: controller.signal }
        );

        if (
          !active ||
          controller.signal.aborted ||
          inFlightRef.current !== request
        ) {
          return;
        }

        lastAckRef.current = Math.max(
          lastAckRef.current,
          result.lastReadSequence
        );

        // REST baseline giúp phục hồi ngay cả
        // khi SignalR event bị bỏ lỡ.
        try {
          await refreshRef.current?.(
            conversationId
          );
        } catch (error) {
          if (import.meta.env.DEV) {
            console.warn(
              "[WebChat Read Sync] " +
                "Cursor refresh failed:",
              error
            );
          }
        }
      } catch (error) {
        if (
          active &&
          !isCanceled(
            error,
            controller.signal
          ) &&
          import.meta.env.DEV
        ) {
          console.warn(
            "[WebChat Read Sync] " +
              "Mark as Read failed:",
            error
          );
        }
      } finally {
        if (inFlightRef.current === request) {
          inFlightRef.current = null;
        }
      }
    }

    function scheduleCheck() {
      if (!active) return;

      if (timer !== null) {
        clearTimeout(timer);
      }

      timer = setTimeout(() => {
        timer = null;
        void tryMarkAsRead();
      }, INITIAL_CHECK_DELAY_MS);
    }

    function onVisibilityChange() {
      if (
        document.visibilityState === "visible"
      ) {
        scheduleCheck();
      }
    }

    // Lấy MessageList đúng trong panel hiện tại.
    // Phase hiện tại chỉ mount một conversation panel.
    const list = document.querySelector(
      ".message-list"
    );

    list?.addEventListener(
      "scroll",
      scheduleCheck,
      { passive: true }
    );

    window.addEventListener(
      "focus",
      scheduleCheck
    );

    document.addEventListener(
      "visibilitychange",
      onVisibilityChange
    );

    scheduleCheck();

    return () => {
      active = false;

      if (timer !== null) {
        clearTimeout(timer);
      }

      list?.removeEventListener(
        "scroll",
        scheduleCheck
      );

      window.removeEventListener(
        "focus",
        scheduleCheck
      );

      document.removeEventListener(
        "visibilitychange",
        onVisibilityChange
      );

      // Nếu effect chạy lại vì metadata mới,
      // hủy ACK cũ để không xác nhận hội thoại
      // ngoài trạng thái hiện tại.
      inFlightRef.current?.controller.abort();
      inFlightRef.current = null;
    };
  }, [
    conversationId,
    currentUserId,
    lastMessageSequence,
    serverReadSequence,
    latestLoadedSequence,
    lastIncomingSequence,
    loading,
  ]);

  return null;
}
