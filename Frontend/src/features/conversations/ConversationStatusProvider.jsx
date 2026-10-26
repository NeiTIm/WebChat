
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";

import { useAuth } from "../auth/hooks/useAuth";

import { useChatRealtime } from
  "../realtime/hooks/useChatRealtime";

import {
  getConversationById,
  getMyConversations,
} from "./api/conversationApi";

import { ConversationStatusContext } from
  "./contexts/ConversationStatusContext";

import {
  normalizeStatusId,
  normalizeConversationStatus,
  mergeConversationStatus,
  applyStatusEvent,
} from "./utils/conversationStatus";

// =====================================================
// CONFIGURATION
// =====================================================

const PAGE_SIZE = 50;
const MAX_PAGES = 200;

// =====================================================
// PHASE 5.8E3 - SAFE INACTIVE CONTEXT
// =====================================================

// Context này chỉ được dùng khi:
// - Chưa đăng nhập
// - Auth đang khởi tạo
// - Đang đăng xuất
// - Chưa có UserId hợp lệ
//
// Không chứa dữ liệu tài khoản cũ.
// Không gửi request REST.
// Không subscribe SignalR.

const INACTIVE_STATUS_CONTEXT = Object.freeze({
  statuses: Object.freeze({}),

  getConversationStatus: () => null,

  mergeConversation: () => {},

  mergeConversations: () => {},

  refreshConversation: async () => null,
});

// =====================================================
// STATUS REDUCER
// =====================================================

function statusReducer(state, action) {
  switch (action.type) {
    case "RESET":
      return {};

    // =================================================
    // MERGE ONE CONVERSATION
    // =================================================

    case "MERGE_ONE": {
      const incoming =
        normalizeConversationStatus(action.dto);

      if (!incoming) {
        return state;
      }

      const id = incoming.conversationId;

      const oldValue = state[id];

      const nextValue =
        mergeConversationStatus(
          oldValue,
          incoming
        );

      if (nextValue === oldValue) {
        return state;
      }

      return {
        ...state,
        [id]: nextValue,
      };
    }

    // =================================================
    // MERGE MANY CONVERSATIONS
    // =================================================

    case "MERGE_MANY": {
      let next = state;

      for (const dto of action.items) {
        const incoming =
          normalizeConversationStatus(dto);

        if (!incoming) {
          continue;
        }

        const id = incoming.conversationId;

        const oldValue = next[id];

        const nextValue =
          mergeConversationStatus(
            oldValue,
            incoming
          );

        if (nextValue === oldValue) {
          continue;
        }

        if (next === state) {
          next = { ...state };
        }

        next[id] = nextValue;
      }

      return next;
    }

    // =================================================
    // APPLY SIGNALR EVENT
    // =================================================

    case "EVENT": {
      const id = normalizeStatusId(
        action.payload?.conversationId
      );

      if (!id || !state[id]) {
        return state;
      }

      const updated = applyStatusEvent(
        state[id],
        action.eventName,
        action.payload,
        action.currentUserId
      );

      if (updated === state[id]) {
        return state;
      }

      return {
        ...state,
        [id]: updated,
      };
    }

    default:
      return state;
  }
}

// =====================================================
// LOAD ALL CONVERSATION STATUS SNAPSHOTS
// =====================================================

async function fetchAllConversationStatuses(
  signal
) {
  const items = [];

  for (
    let page = 1;
    page <= MAX_PAGES;
    page += 1
  ) {
    signal.throwIfAborted();

    const result = await getMyConversations({
      page,
      pageSize: PAGE_SIZE,
      signal,
    });

    if (!Array.isArray(result?.items)) {
      throw new Error(
        "Conversation status response không hợp lệ."
      );
    }

    items.push(...result.items);

    // Hỗ trợ hai kiểu pagination metadata.
    const hasNext =
      typeof result.hasNextPage === "boolean"
        ? result.hasNextPage
        : (
            Number.isInteger(result.totalPages) &&
            page < result.totalPages
          );

    if (!hasNext) {
      return items;
    }

    if (result.items.length === 0) {
      throw new Error(
        "Phân trang conversation không tiến triển."
      );
    }
  }

  throw new Error(
    "Số trang conversation vượt giới hạn đồng bộ."
  );
}

// =====================================================
// AUTHENTICATED STATUS SESSION
// =====================================================

function StatusSession({
  userId,
  children,
}) {
  const {
    subscribe,
    syncVersion,
  } = useChatRealtime();

  const [statuses, dispatch] = useReducer(
    statusReducer,
    {}
  );

  const activeRef = useRef(true);

  const detailRequestsRef = useRef(
    new Map()
  );

  // =====================================================
  // MERGE TRUSTED REST DATA
  // =====================================================

  const mergeConversation = useCallback(
    (dto) => {
      dispatch({
        type: "MERGE_ONE",
        dto,
      });
    },
    []
  );

  const mergeConversations = useCallback(
    (items) => {
      if (
        !Array.isArray(items) ||
        items.length === 0
      ) {
        return;
      }

      dispatch({
        type: "MERGE_MANY",
        items,
      });
    },
    []
  );

  // =====================================================
  // REFRESH ONE CONVERSATION
  // =====================================================

  const refreshConversation = useCallback(
    async (
      conversationId,
      { signal } = {}
    ) => {
      const id = normalizeStatusId(
        conversationId
      );

      if (
        !id ||
        !activeRef.current
      ) {
        return null;
      }

      // Dùng chung request đang chạy
      // để tránh gọi trùng REST.
      const existing =
        detailRequestsRef.current.get(id);

      if (existing) {
        return existing.promise;
      }

      const controller =
        new AbortController();

      const abortFromParent = () => {
        controller.abort();
      };

      if (signal?.aborted) {
        controller.abort();
      } else {
        signal?.addEventListener(
          "abort",
          abortFromParent,
          { once: true }
        );
      }

      const promise = (async () => {
        const dto =
          await getConversationById(
            id,
            {
              signal: controller.signal,
            }
          );

        if (
          !activeRef.current ||
          controller.signal.aborted
        ) {
          return null;
        }

        if (
          normalizeStatusId(dto?.id) !== id ||
          !normalizeConversationStatus(dto)
        ) {
          throw new Error(
            "Conversation status detail không hợp lệ."
          );
        }

        mergeConversation(dto);

        return dto;
      })();

      detailRequestsRef.current.set(id, {
        controller,
        promise,
      });

      try {
        return await promise;
      } finally {
        signal?.removeEventListener(
          "abort",
          abortFromParent
        );

        if (
          detailRequestsRef.current.get(id)
            ?.promise === promise
        ) {
          detailRequestsRef.current.delete(id);
        }
      }
    },
    [mergeConversation]
  );

  // =====================================================
  // INITIAL LOAD / RECONNECT
  // =====================================================

  useEffect(() => {
    activeRef.current = true;

    const controller =
      new AbortController();

    async function loadBaseline() {
      try {
        const items =
          await fetchAllConversationStatuses(
            controller.signal
          );

        if (
          !controller.signal.aborted &&
          activeRef.current
        ) {
          mergeConversations(items);
        }
      } catch (error) {
        if (
          !controller.signal.aborted &&
          import.meta.env.DEV
        ) {
          console.warn(
            "[5.8E2] Conversation cursor sync failed:",
            error
          );
        }
      }
    }

    void loadBaseline();

    return () => {
      controller.abort();
    };
  }, [
    syncVersion,
    mergeConversations,
  ]);

  // =====================================================
  // REALTIME READ / DELIVERED
  // =====================================================

  useEffect(() => {
    activeRef.current = true;

    function processEvent(
      eventName,
      payload
    ) {
      const id = normalizeStatusId(
        payload?.conversationId
      );

      if (!id) {
        return;
      }

      // Store chỉ áp dụng event trực tiếp
      // khi đã có metadata REST xác thực.
      dispatch({
        type: "EVENT",
        eventName,
        payload,
        currentUserId: userId,
      });

      // Nếu event tới trước REST metadata,
      // truy vấn conversation detail để phục hồi.
      //
      // Merge monotonic ngăn REST response cũ
      // làm giảm cursor đã nhận từ realtime.
      //
      // Sau detail, áp dụng lại event để
      // không bỏ lỡ event khi store còn rỗng.

      void refreshConversation(id)
        .then((dto) => {
          if (
            !dto ||
            !activeRef.current
          ) {
            return;
          }

          dispatch({
            type: "EVENT",
            eventName,
            payload,
            currentUserId: userId,
          });
        })
        .catch((error) => {
          if (import.meta.env.DEV) {
            console.warn(
              "[5.8E2] Event detail verification failed:",
              id,
              error
            );
          }
        });
    }

    // =================================================
    // READ EVENT
    // =================================================

    const unsubscribeRead = subscribe(
      "MessageReadUpdated",
      (payload) => {
        processEvent(
          "MessageReadUpdated",
          payload
        );
      }
    );

    // =================================================
    // DELIVERED EVENT
    // =================================================

    const unsubscribeDelivered = subscribe(
      "MessageDeliveredUpdated",
      (payload) => {
        processEvent(
          "MessageDeliveredUpdated",
          payload
        );
      }
    );

    return () => {
      unsubscribeRead();
      unsubscribeDelivered();
    };
  }, [
    subscribe,
    refreshConversation,
    userId,
  ]);

  // =====================================================
  // SESSION CLEANUP
  // =====================================================

  useEffect(() => {
    activeRef.current = true;

    const detailRequests =
      detailRequestsRef.current;

    return () => {
      activeRef.current = false;

      for (
        const request of detailRequests.values()
      ) {
        request.controller.abort();
      }

      detailRequests.clear();
    };
  }, []);

  // =====================================================
  // CONTEXT FUNCTIONS
  // =====================================================

  const getConversationStatus = useCallback(
    (conversationId) =>
      statuses[
        normalizeStatusId(conversationId)
      ] ?? null,
    [statuses]
  );

  const value = useMemo(
    () => ({
      statuses,
      getConversationStatus,
      mergeConversation,
      mergeConversations,
      refreshConversation,
    }),
    [
      statuses,
      getConversationStatus,
      mergeConversation,
      mergeConversations,
      refreshConversation,
    ]
  );

  return (
    <ConversationStatusContext.Provider
      value={value}
    >
      {children}
    </ConversationStatusContext.Provider>
  );
}

// =====================================================
// PHASE 5.8E3 - ACCOUNT-SCOPED PROVIDER
// =====================================================

export default function ConversationStatusProvider({
  children,
}) {
  const {
    user,
    isAuthenticated,
    isInitializing,
    isLoggingOut,
  } = useAuth();

  const userId = normalizeStatusId(
    user?.id || user?.userId
  );

  const sessionReady =
    isAuthenticated &&
    !isInitializing &&
    !isLoggingOut &&
    Boolean(userId);

  // =====================================================
  // INACTIVE AUTH SESSION
  // =====================================================

  // SỬA LỖI:
  //
  // Trước đây:
  //   return children;
  //
  // Điều đó khiến ConversationStatusBridge
  // hoặc ConversationMessagesPanel có thể
  // render khi không có Context Provider.
  //
  // Bây giờ:
  // - Context luôn tồn tại.
  // - Không có cursor từ session trước.
  // - Login / Register vẫn render.
  // - ProtectedRoute vẫn hoạt động.

  if (!sessionReady) {
    return (
      <ConversationStatusContext.Provider
        value={INACTIVE_STATUS_CONTEXT}
      >
        {children}
      </ConversationStatusContext.Provider>
    );
  }

  // =====================================================
  // ACTIVE AUTH SESSION
  // =====================================================

  // key theo UserId:
  // - Đổi account => remount StatusSession.
  // - Reset statuses.
  // - Abort REST request cũ.
  // - Unsubscribe event cũ.
  // - Không chia sẻ cursor giữa hai account.

  return (
    <StatusSession
      key={userId}
      userId={userId}
    >
      {children}
    </StatusSession>
  );
}
