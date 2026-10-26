
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
// PHASE 5.8E3 - GLOBAL DELIVERY SYNC
// =====================================================

const PAGE_SIZE = 50;
const MAX_HISTORY_PAGES = 20;
const MAX_CONVERSATION_PAGES = 200;
const SYNC_DELAY = 300;

const DEBUG = import.meta.env.DEV;

function normalizeId(value) {
  return String(value ?? "").trim().toLowerCase();
}

function isCanceled(error, signal) {
  return (
    signal?.aborted ||
    error?.name === "AbortError" ||
    error?.code === "ERR_CANCELED"
  );
}

function log(...args) {
  if (DEBUG) {
    console.log("[Delivery Sync]", ...args);
  }
}

function warn(...args) {
  if (DEBUG) {
    console.warn("[Delivery Sync]", ...args);
  }
}

// =====================================================
// 1. LOAD CONVERSATIONS
// =====================================================

async function loadConversations(signal) {
  const conversations = [];

  for (
    let page = 1;
    page <= MAX_CONVERSATION_PAGES;
    page++
  ) {
    signal.throwIfAborted();

    const response = await getDeliveryCursorPage({
      page,
      pageSize: PAGE_SIZE,
      signal,
    });

    if (
      !response ||
      !Array.isArray(response.items) ||
      !Number.isSafeInteger(response.totalPages) ||
      response.totalPages < 0
    ) {
      throw new Error(
        "Delivery cursor response không hợp lệ."
      );
    }

    conversations.push(...response.items);

    if (page >= response.totalPages) {
      return conversations;
    }

    if (response.items.length === 0) {
      throw new Error(
        "Không thể tải tiếp conversation."
      );
    }
  }

  throw new Error(
    "Quá giới hạn số trang conversation."
  );
}

// =====================================================
// 2. VERIFY RECEIVED MESSAGES
// =====================================================

// Chỉ ACK những sequence thực sự tải được
// và liên tục từ cursor hiện tại.
//
// Ví dụ:
// baseline = 116
// target = 119
// tải được 117,118,119
// => ACK 119.
//
// Nếu thiếu 118
// => chỉ ACK 117.
//
// Không tự bỏ qua khoảng trống lịch sử.

async function verifyDelivery({
  conversationId,
  baseline,
  target,
  signal,
}) {
  if (target <= baseline) {
    return baseline;
  }

  const messages = new Map();

  let beforeSequence = null;

  for (
    let page = 0;
    page < MAX_HISTORY_PAGES;
    page++
  ) {
    signal.throwIfAborted();

    const response = await getConversationMessages(
      conversationId,
      {
        beforeSequence,
        pageSize: PAGE_SIZE,
        signal,
      }
    );

    if (
      normalizeId(response?.conversationId) !==
        conversationId ||
      !Array.isArray(response.items) ||
      typeof response.hasMore !== "boolean"
    ) {
      throw new Error(
        "Message history response không hợp lệ."
      );
    }

    if (response.items.length === 0) {
      if (response.hasMore) {
        throw new Error(
          "Message pagination không tiến triển."
        );
      }

      break;
    }

    let lowestSequence = Number.MAX_SAFE_INTEGER;

    for (const message of response.items) {
      const sequence = message?.sequenceNumber;

      if (
        normalizeId(message?.conversationId) !==
          conversationId ||
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
        messages.set(sequence, message);
      }
    }

    // Đã tải tới vị trí bắt đầu kiểm tra.
    if (lowestSequence <= baseline + 1) {
      break;
    }

    if (
      beforeSequence !== null &&
      lowestSequence >= beforeSequence
    ) {
      throw new Error(
        "Message pagination không tiến triển."
      );
    }

    if (!response.hasMore) {
      break;
    }

    beforeSequence = lowestSequence;
  }

  signal.throwIfAborted();

  return findContiguousCursor({
    conversationId,
    baseline,
    target,
    messages: [...messages.values()],
  });
}

// =====================================================
// 3. GLOBAL DELIVERY SYNC
// =====================================================

export default function GlobalDeliverySync() {
  const {
    user,
    isAuthenticated,
    isInitializing,
    isLoggingOut,
  } = useAuth();

  const {
    subscribe,
    syncVersion,
  } = useChatRealtime();

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

    let active = true;
    let running = false;
    let rerun = false;
    let syncAll = true;

    let timer = null;
    let controller = null;

    const pendingIds = new Set();

    // =================================================
    // SYNC ONE CONVERSATION
    // =================================================

    async function syncConversation(item, signal) {
      const conversationId = normalizeId(
        item?.conversationId
      );

      const baseline =
        item?.myLastDeliveredSequence;

      const target =
        item?.lastMessageSequence;

      if (
        !conversationId ||
        !isValidSequence(baseline) ||
        !isValidSequence(target)
      ) {
        warn("Invalid snapshot", item);
        return;
      }

      if (target <= baseline) {
        return;
      }

      log("Verifying", {
        conversationId,
        baseline,
        target,
      });

      const verifiedCursor =
        await verifyDelivery({
          conversationId,
          baseline,
          target,
          signal,
        });

      if (!active || signal.aborted) {
        return;
      }

      if (verifiedCursor <= baseline) {
        warn("History gap, ACK skipped", {
          conversationId,
          baseline,
          target,
        });

        return;
      }

      // Chỉ gửi sequence đã xác minh.
      const response = await markAsDelivered(
        conversationId,
        verifiedCursor,
        { signal }
      );

      if (
        normalizeId(response?.conversationId) !==
          conversationId ||
        !isValidSequence(
          response?.lastDeliveredSequence
        ) ||
        response.lastDeliveredSequence <
          verifiedCursor
      ) {
        throw new Error(
          "Delivered ACK response không hợp lệ."
        );
      }

      log("Delivered ACK success", {
        conversationId,
        requested: verifiedCursor,
        saved: response.lastDeliveredSequence,
        changed: response.changed,
      });
    }

    // =================================================
    // RUN SYNC
    // =================================================

    async function runSync() {
      if (!active) {
        return;
      }

      if (running) {
        rerun = true;
        return;
      }

      running = true;

      const currentController =
        new AbortController();

      controller = currentController;

      const shouldSyncAll = syncAll;
      const requestedIds = new Set(pendingIds);

      syncAll = false;
      pendingIds.clear();

      try {
        const snapshots =
          await loadConversations(
            currentController.signal
          );

        if (
          !active ||
          currentController.signal.aborted
        ) {
          return;
        }

        const selected = shouldSyncAll
          ? snapshots
          : snapshots.filter((item) =>
              requestedIds.has(
                normalizeId(item.conversationId)
              )
            );

        log("Synchronization started", {
          userId,
          conversations: selected.length,
        });

        for (const item of selected) {
          if (
            !active ||
            currentController.signal.aborted
          ) {
            break;
          }

          try {
            await syncConversation(
              item,
              currentController.signal
            );
          } catch (error) {
            if (
              isCanceled(
                error,
                currentController.signal
              )
            ) {
              break;
            }

            warn(
              "Conversation sync failed",
              item?.conversationId,
              error
            );
          }
        }
      } catch (error) {
        if (
          active &&
          !isCanceled(
            error,
            currentController.signal
          )
        ) {
          warn("Global sync failed", error);
        }
      } finally {
        if (controller === currentController) {
          controller = null;
        }

        running = false;

        if (active && rerun) {
          rerun = false;
          scheduleSync();
        }
      }
    }

    // =================================================
    // SCHEDULE SYNC
    // =================================================

    function scheduleSync(conversationId = null) {
      if (!active) {
        return;
      }

      if (conversationId) {
        pendingIds.add(
          normalizeId(conversationId)
        );
      } else {
        syncAll = true;
      }

      if (running) {
        rerun = true;
        return;
      }

      if (timer !== null) {
        clearTimeout(timer);
      }

      timer = setTimeout(() => {
        timer = null;
        void runSync();
      }, SYNC_DELAY);
    }

    // =================================================
    // MESSAGE CREATED
    // =================================================

    const unsubscribeMessage = subscribe(
      "MessageCreated",
      (message) => {
        const conversationId = normalizeId(
          message?.conversationId
        );

        if (!conversationId) {
          return;
        }

        log(
          "MessageCreated received",
          conversationId,
          message?.sequenceNumber
        );

        // Không yêu cầu người dùng mở chat.
        scheduleSync(conversationId);
      }
    );

    // =================================================
    // CONVERSATION UPDATED
    // =================================================

    const unsubscribeConversation = subscribe(
      "ConversationUpdated",
      (payload) => {
        if (payload?.conversationId) {
          scheduleSync(payload.conversationId);
        }
      }
    );

    // =================================================
    // DELIVERED UPDATED
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

        // Thiết bị khác vừa ACK.
        // Đọc lại snapshot từ Backend.
        scheduleSync(payload.conversationId);
      }
    );

    // =================================================
    // INITIAL / RECONNECT
    // =================================================

    scheduleSync();

    // =================================================
    // CLEANUP
    // =================================================

    return () => {
      active = false;

      if (timer !== null) {
        clearTimeout(timer);
      }

      controller?.abort();
      pendingIds.clear();

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
