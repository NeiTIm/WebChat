
import { useEffect } from "react";

import { useAuth } from "../../auth/hooks/useAuth";
import { useChatRealtime } from "../../realtime/hooks/useChatRealtime";

import { getConversationMessages } from "../api/messageApi";
import {
  getDeliveryCursorPage,
  markAsDelivered,
} from "../api/deliveryApi";

import {
  findContiguousCursor,
  isValidSequence,
} from "../utils/deliveryCursor";

// =====================================================
// CONFIGURATION
// =====================================================

const MESSAGE_PAGE_SIZE = 50;
const MAX_HISTORY_PAGES = 20;

const CONVERSATION_PAGE_SIZE = 50;
const MAX_CONVERSATION_PAGES = 200;

const SYNC_DEBOUNCE_MS = 500;

// =====================================================
// HELPERS
// =====================================================

function normalizeId(value) {
  return String(value ?? "").trim().toLowerCase();
}

function isCanceled(error, signal) {
  return (
    signal?.aborted ||
    error?.code === "ERR_CANCELED" ||
    error?.name === "AbortError"
  );
}

// =====================================================
// FETCH DELIVERY CURSORS
// =====================================================

async function loadDeliverySnapshots(signal) {
  const snapshots = [];

  for (
    let page = 1;
    page <= MAX_CONVERSATION_PAGES;
    page += 1
  ) {
    signal.throwIfAborted();

    const result = await getDeliveryCursorPage({
      page,
      pageSize: CONVERSATION_PAGE_SIZE,
      signal,
    });

    if (
      !result ||
      !Array.isArray(result.items) ||
      !Number.isSafeInteger(result.totalPages)
    ) {
      throw new Error(
        "Delivery cursor response không hợp lệ."
      );
    }

    snapshots.push(...result.items);

    if (page >= result.totalPages) {
      return snapshots;
    }

    if (result.items.length === 0) {
      throw new Error(
        "Phân trang Delivery Cursor không đầy đủ."
      );
    }
  }

  throw new Error(
    "Quá giới hạn phân trang Delivery Cursor."
  );
}

// =====================================================
// FETCH AND VERIFY CONTIGUOUS HISTORY
// =====================================================

async function loadVerifiedMessages({
  conversationId,
  baseline,
  target,
  signal,
}) {
  if (target <= baseline) {
    return [];
  }

  const received = new Map();

  let beforeSequence = null;

  for (
    let page = 0;
    page < MAX_HISTORY_PAGES;
    page += 1
  ) {
    signal.throwIfAborted();

    const result = await getConversationMessages(
      conversationId,
      {
        beforeSequence,
        pageSize: MESSAGE_PAGE_SIZE,
        signal,
      }
    );

    if (
      normalizeId(result?.conversationId) !==
        normalizeId(conversationId) ||
      !Array.isArray(result.items)
    ) {
      throw new Error(
        "Lịch sử tin nhắn không hợp lệ."
      );
    }

    if (result.items.length === 0) {
      break;
    }

    let lowestSequence = Number.MAX_SAFE_INTEGER;

    for (const message of result.items) {
      const sequence = message?.sequenceNumber;

      if (
        normalizeId(message?.conversationId) !==
          normalizeId(conversationId) ||
        !Number.isSafeInteger(sequence) ||
        sequence <= 0
      ) {
        throw new Error(
          "Message sequence không hợp lệ."
        );
      }

      lowestSequence = Math.min(
        lowestSequence,
        sequence
      );

      if (
        sequence > baseline &&
        sequence <= target
      ) {
        received.set(sequence, message);
      }
    }

    // Đã tải tới sát baseline.
    if (lowestSequence <= baseline + 1) {
      break;
    }

    // beforeSequence phải giảm liên tục.
    if (
      beforeSequence !== null &&
      lowestSequence >= beforeSequence
    ) {
      throw new Error(
        "Phân trang lịch sử không tiến triển."
      );
    }

    if (!result.hasMore) {
      break;
    }

    beforeSequence = lowestSequence;
  }

  const messages = [...received.values()];

  const contiguousCursor = findContiguousCursor({
    baseline,
    target,
    messages,
    conversationId,
  });

  // Không ACK khi thiếu bất kỳ sequence nào
  // trong khoảng cần xác minh.
  if (contiguousCursor < target) {
    return null;
  }

  return messages;
}

// =====================================================
// GLOBAL DELIVERY SYNC
// =====================================================

export default function GlobalDeliverySync() {
  const {
    user,
    isAuthenticated,
    isInitializing,
    isLoggingOut,
  } = useAuth();

  const { subscribe, syncVersion } = useChatRealtime();

  const userId = normalizeId(
    user?.id || user?.userId
  );

  useEffect(() => {
    if (
      !isAuthenticated ||
      isInitializing ||
      isLoggingOut ||
      !userId
    ) {
      return undefined;
    }

    // Toàn bộ biến này thuộc về một phiên effect.
    // Khi user/logout/syncVersion thay đổi,
    // cleanup sẽ hủy các request cũ.

    let active = true;
    let running = false;
    let rerun = false;
    let timerId = null;

    let requestController = null;

    const pendingConversationIds = new Set();

    // null: đồng bộ toàn bộ conversation.
    // Set: đồng bộ các conversation được yêu cầu.
    let synchronizeAll = true;

    // =================================================
    // SYNC ONE CONVERSATION
    // =================================================

    async function synchronizeConversation(
      item,
      signal
    ) {
      const conversationId = item?.conversationId;

      const baseline =
        item?.myLastDeliveredSequence;

      const target =
        item?.lastMessageSequence;

      if (
        !conversationId ||
        !isValidSequence(baseline) ||
        !isValidSequence(target) ||
        target <= baseline
      ) {
        return;
      }

      const messages = await loadVerifiedMessages({
        conversationId,
        baseline,
        target,
        signal,
      });

      if (!messages || signal.aborted || !active) {
        return;
      }

      const contiguousCursor = findContiguousCursor({
        baseline,
        target,
        messages,
        conversationId,
      });

      if (contiguousCursor <= baseline) {
        return;
      }

      // Kiểm tra lại session local trước khi
      // phát request. Authentication middleware
      // backend vẫn là lớp bảo mật quyết định.
      signal.throwIfAborted();

      const result = await markAsDelivered(
        conversationId,
        contiguousCursor,
        { signal }
      );

      if (
        normalizeId(result?.conversationId) !==
          normalizeId(conversationId) ||
        !isValidSequence(
          result?.lastDeliveredSequence
        ) ||
        result.lastDeliveredSequence <
          contiguousCursor
      ) {
        throw new Error(
          "Delivered ACK response không hợp lệ."
        );
      }
    }

    // =================================================
    // SYNC ALL OR TARGETED CONVERSATIONS
    // =================================================

    async function runSynchronization() {
      if (!active) {
        return;
      }

      if (running) {
        rerun = true;
        return;
      }

      running = true;

      const controller = new AbortController();

      requestController = controller;

      // Lấy snapshot yêu cầu trước khi bắt đầu.
      const all = synchronizeAll;

      const targets = new Set(
        pendingConversationIds
      );

      synchronizeAll = false;
      pendingConversationIds.clear();

      try {
        const snapshots = await loadDeliverySnapshots(
          controller.signal
        );

        if (!active || controller.signal.aborted) {
          return;
        }

        const selected = all
          ? snapshots
          : snapshots.filter((item) =>
              targets.has(
                normalizeId(item.conversationId)
              )
            );

        // ACK lần lượt từng conversation.
        // Không gửi request song song cạnh tranh
        // trong cùng effect.
        for (const item of selected) {
          if (!active || controller.signal.aborted) {
            break;
          }

          try {
            await synchronizeConversation(
              item,
              controller.signal
            );
          } catch (error) {
            if (
              isCanceled(
                error,
                controller.signal
              )
            ) {
              break;
            }

            if (import.meta.env.DEV) {
              console.warn(
                "[WebChat 5.8D4] Sync failed:",
                item?.conversationId,
                error
              );
            }
          }
        }
      } catch (error) {
        if (
          active &&
          !isCanceled(error, controller.signal) &&
          import.meta.env.DEV
        ) {
          console.warn(
            "[WebChat 5.8D4] Global sync failed:",
            error
          );
        }
      } finally {
        if (requestController === controller) {
          requestController = null;
        }

        running = false;

        // Các event đến trong lúc đang đồng bộ
        // được xử lý bằng lượt tiếp theo.
        if (active && rerun) {
          rerun = false;
          scheduleSynchronization();
        }
      }
    }

    // =================================================
    // SCHEDULE SYNCHRONIZATION
    // =================================================

    function scheduleSynchronization(
      conversationId = null
    ) {
      if (!active) {
        return;
      }

      if (conversationId) {
        pendingConversationIds.add(
          normalizeId(conversationId)
        );
      } else {
        synchronizeAll = true;
      }

      if (running) {
        rerun = true;
        return;
      }

      if (timerId !== null) {
        clearTimeout(timerId);
      }

      timerId = setTimeout(() => {
        timerId = null;
        void runSynchronization();
      }, SYNC_DEBOUNCE_MS);
    }

    // =================================================
    // REALTIME MESSAGE CREATED
    // =================================================

    const unsubscribeMessage = subscribe(
      "MessageCreated",
      (message) => {
        if (message?.conversationId) {
          scheduleSynchronization(
            message.conversationId
          );
        }
      }
    );

    // =================================================
    // CONVERSATION METADATA UPDATED
    // =================================================

    const unsubscribeConversation = subscribe(
      "ConversationUpdated",
      (payload) => {
        if (payload?.conversationId) {
          scheduleSynchronization(
            payload.conversationId
          );
        }
      }
    );

    // =================================================
    // DELIVERED CURSOR UPDATED
    // =================================================

    const unsubscribeDelivered = subscribe(
      "MessageDeliveredUpdated",
      (payload) => {
        if (
          normalizeId(payload?.recipientUserId) !==
          userId ||
          !payload?.conversationId
        ) {
          return;
        }

        // Lấy lại baseline từ SQL Server.
        // Không tự lấy sequence trong event
        // làm bằng chứng đã nhận đủ history.
        scheduleSynchronization(
          payload.conversationId
        );
      }
    );

    // =================================================
    // START GLOBAL SYNC
    // =================================================

    // Chạy khi đăng nhập, đồng thời chạy lại
    // sau syncVersion thay đổi (reconnect).
    scheduleSynchronization();

    // =================================================
    // CLEANUP
    // =================================================

    return () => {
      active = false;

      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }

      requestController?.abort();

      pendingConversationIds.clear();

      unsubscribeMessage();
      unsubscribeConversation();
      unsubscribeDelivered();
    };
  }, [
    userId,
    isAuthenticated,
    isInitializing,
    isLoggingOut,
    subscribe,
    syncVersion,
  ]);

  return null;
}
