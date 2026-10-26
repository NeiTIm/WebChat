
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import {
  MessageCircle,
  MessagesSquare,
  X,
} from "lucide-react";

import { useAuth } from "../../auth/hooks/useAuth";
import { useChatRealtime } from "../../realtime/hooks/useChatRealtime";
import { useConversationPresence } from "../../realtime/hooks/useConversationPresence";

import axiosClient from "../../../api/axiosClient";

import ConversationList from "../components/ConversationList";
import ChatHeader from "../components/ChatHeader";
import ConversationMessagesPanel from "../components/ConversationMessagesPanel";
import ConversationStatusBridge from "../components/ConversationStatusBridge";

import {
  getMyConversations,
  getConversationById,
  getConversationApiError,
} from "../api/conversationApi";

import "../../../styles/messenger.css";
import "../../../styles/messenger-polish.css";

const PAGE_SIZE = 20;

const PERMISSION_REFRESH_DELAY = 120;

const VERIFYING_PERMISSION_REASON =
  "Đang xác minh lại quyền gửi tin nhắn...";

const PERMISSION_SYNC_ERROR_REASON =
  "Chưa thể xác minh quyền hội thoại. Vui lòng làm mới để thử lại.";

// =====================================================
// HELPERS
// =====================================================

function normalizeId(value) {
  return String(value || "").toLowerCase();
}

function getInitials(name) {
  return String(name || "U")
    .trim()
    .split(/\s+/)
    .slice(-2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}

function formatMessageTime(value) {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function toConversationViewModel(dto) {
  const name =
    dto.otherDisplayName ||
    dto.otherUsername ||
    "Người dùng";

  return {
    id: dto.id,
    type: "private",
    otherUserId: dto.otherUserId,
    name,
    username: dto.otherUsername,
    avatarUrl: dto.otherAvatarUrl,
    initials: getInitials(name),
    avatarColor: "#e6efff",
    avatarTextColor: "#2563eb",
    online: null,
    unreadCount: dto.unreadCount ?? 0,

    lastMessage:
      typeof dto.lastMessageContent === "string"
        ? dto.lastMessageContent
        : dto.lastMessageSequence > 0
          ? "Mở để xem tin nhắn"
          : "Chưa có tin nhắn",

    lastMessageContent: dto.lastMessageContent,
    lastMessageSenderId: dto.lastMessageSenderId,
    lastMessagePreviewSequence:
      Number.isSafeInteger(dto.lastMessagePreviewSequence)
        ? dto.lastMessagePreviewSequence
        : typeof dto.lastMessageContent === "string" &&
            dto.lastMessageSenderId
          ? dto.lastMessageSequence
          : null,

    lastMessageTime: formatMessageTime(
      dto.lastMessageAtUtc
    ),

    canSendMessage: dto.canSendMessage,
    cannotSendReason: dto.cannotSendReason,
    lastMessageSequence: dto.lastMessageSequence,
    lastReadSequence: dto.lastReadSequence,
    createdAtUtc: dto.createdAtUtc,
    lastMessageAtUtc: dto.lastMessageAtUtc,
  };
}

// =====================================================
// SORT CONVERSATIONS
// =====================================================

function sortConversations(items) {
  return [...items].sort((a, b) => {
    const timeA = Date.parse(
      a.lastMessageAtUtc || a.createdAtUtc || ""
    );

    const timeB = Date.parse(
      b.lastMessageAtUtc || b.createdAtUtc || ""
    );

    const safeTimeA = Number.isFinite(timeA)
      ? timeA
      : 0;

    const safeTimeB = Number.isFinite(timeB)
      ? timeB
      : 0;

    if (safeTimeA !== safeTimeB) {
      return safeTimeB - safeTimeA;
    }

    return String(b.id).localeCompare(String(a.id));
  });
}

// =====================================================
// DEDUPLICATE BY CONVERSATION ID
// =====================================================

function deduplicateConversations(items) {
  const map = new Map();

  for (const item of items) {
    if (!item?.id) continue;

    const id = normalizeId(item.id);
    const existing = map.get(id);

    if (
      !existing ||
      (item.lastMessageSequence ?? 0) >
        (existing.lastMessageSequence ?? 0)
    ) {
      map.set(id, item);
    }
  }

  return [...map.values()];
}

// =====================================================
// APPLY REALTIME METADATA
// =====================================================

function applyConversationUpdate(item, payload) {
  const currentSequence =
    item.lastMessageSequence ?? 0;

  const incomingSequence =
    payload.lastMessageSequence;

  if (
    !Number.isSafeInteger(incomingSequence) ||
    incomingSequence <= currentSequence
  ) {
    return item;
  }

  return {
    ...item,
    lastMessageSequence: incomingSequence,
    // Preview cũ không còn hợp lệ cho sequence mới.
    lastMessagePreviewSequence: null,
    lastMessageContent: null,
    lastMessageSenderId: null,
    lastMessageAtUtc:
      payload.lastMessageAtUtc ??
      item.lastMessageAtUtc,
  };
}

function applyMessagePreview(item, message) {
  if (
    !item ||
    !message ||
    normalizeId(item.id) !== normalizeId(message.conversationId)
  ) {
    return item;
  }

  const sequence = message.sequenceNumber;
  if (
    !Number.isSafeInteger(sequence) ||
    sequence <= 0 ||
    typeof message.content !== "string" ||
    !message.senderId
  ) {
    return item;
  }

  const currentSequence = item.lastMessageSequence ?? 0;
  const currentPreviewSequence = item.lastMessagePreviewSequence ?? 0;

  if (sequence < currentSequence || sequence < currentPreviewSequence) {
    return item;
  }

  const content = message.recalledAtUtc
    ? "Tin nhắn đã được thu hồi"
    : message.content;

  return {
    ...item,
    lastMessageSequence: sequence,
    lastMessagePreviewSequence: sequence,
    lastMessageContent: content,
    lastMessage: content,
    lastMessageSenderId: message.senderId,
    lastMessageAtUtc: message.createdAtUtc ?? item.lastMessageAtUtc,
  };
}

// REST chỉ ghi đè trạng thái realtime khi có cùng hoặc sequence mới hơn.
function mergeConversationSnapshot(current, incoming) {
  if (!current) return incoming;
  const currentSeq = current.lastMessageSequence ?? 0;
  const incomingSeq = incoming.lastMessageSequence ?? 0;

  if (currentSeq > incomingSeq) {
    return {
      ...incoming,
      lastMessageSequence: currentSeq,
      lastMessageAtUtc: current.lastMessageAtUtc,
      lastMessageContent: current.lastMessageContent,
      lastMessageSenderId: current.lastMessageSenderId,
      lastMessagePreviewSequence: current.lastMessagePreviewSequence,
      lastReadSequence: Math.max(
        current.lastReadSequence ?? 0,
        incoming.lastReadSequence ?? 0
      ),
    };
  }

  if (currentSeq === incomingSeq) {
    const currentHasPreview =
      current.lastMessagePreviewSequence === currentSeq &&
      typeof current.lastMessageContent === "string";
    const incomingHasPreview =
      typeof incoming.lastMessageContent === "string" &&
      Boolean(incoming.lastMessageSenderId);

    return {
      ...incoming,
      ...(currentHasPreview && !incomingHasPreview
        ? {
            lastMessageContent: current.lastMessageContent,
            lastMessageSenderId: current.lastMessageSenderId,
            lastMessagePreviewSequence: current.lastMessagePreviewSequence,
          }
        : {}),
      lastReadSequence: Math.max(
        current.lastReadSequence ?? 0,
        incoming.lastReadSequence ?? 0
      ),
    };
  }

  return incoming;
}

// =====================================================
// MAIN PAGE
// =====================================================

export default function MessengerPage() {
  const { user } = useAuth();

  const {
    subscribe,
    syncVersion,
  } = useChatRealtime();

  const navigate = useNavigate();
  const { conversationId } = useParams();

  const [refreshKey, setRefreshKey] = useState(0);
  const [notice, setNotice] = useState("");

  // =====================================================
  // CONVERSATION LIST STATE
  // =====================================================

  const [listState, setListState] = useState({
    key: null,
    items: [],
    hasMore: false,
    nextPage: null,
    error: "",
  });

  const [loadingMore, setLoadingMore] =
    useState(false);

  const [loadMoreError, setLoadMoreError] =
    useState("");

  const [listSyncError, setListSyncError] =
    useState("");

  const loadMoreBusyRef = useRef(false);
  const listGenerationRef = useRef(0);
  const loadMoreControllerRef = useRef(null);

  const listStateRef = useRef(listState);

  useEffect(() => {
    listStateRef.current = listState;
  }, [listState]);

  const listKey = `conversations-${refreshKey}`;

  const listReady = listState.key === listKey;

  const conversations = listReady
    ? listState.items
    : [];

  const loadingList = !listReady;

  const hasMore =
    listReady && listState.hasMore;

  const nextPage = listReady
    ? listState.nextPage
    : null;

  const listError = listReady
    ? listState.error || loadMoreError
    : "";

  // =====================================================
  // 5.8E3 - READ ACK FROM VISIBLE PREVIEW
  // =====================================================

  const previewReadBusyRef = useRef(new Set());
  const previewReadConfirmedRef = useRef(new Map());

  const currentUserId = user?.id || user?.userId || null;
  const normalizedCurrentUserId = normalizeId(currentUserId);

  const handlePreviewSeen = useCallback(
    async (rawConversationId, sequence) => {
      const id = normalizeId(rawConversationId);
      if (
        !id ||
        !normalizedCurrentUserId ||
        !Number.isSafeInteger(sequence) ||
        sequence <= 0 ||
        document.visibilityState !== "visible" ||
        !document.hasFocus()
      ) {
        return;
      }

      const state = listStateRef.current;
      if (state.key !== listKey) return;

      const conversation = state.items.find(
        (item) => normalizeId(item.id) === id
      );
      if (
        !conversation ||
        conversation.lastMessageSequence !== sequence ||
        conversation.lastMessagePreviewSequence !== sequence ||
        typeof conversation.lastMessageContent !== "string" ||
        !conversation.lastMessageContent.trim() ||
        !conversation.lastMessageSenderId ||
        normalizeId(conversation.lastMessageSenderId) ===
          normalizedCurrentUserId ||
        conversation.lastMessageContent === "Tin nhắn đã được thu hồi"
      ) {
        return;
      }

      const alreadyRead = Math.max(
        conversation.lastReadSequence ?? 0,
        previewReadConfirmedRef.current.get(id) ?? 0
      );
      if (sequence <= alreadyRead || previewReadBusyRef.current.has(id)) {
        return;
      }

      previewReadBusyRef.current.add(id);
      try {
        const response = await axiosClient.post(
          `/api/conversations/${encodeURIComponent(id)}/read`,
          { lastReadSequence: sequence }
        );

        const acknowledgedSequence = response.data?.lastReadSequence;
        if (
          !Number.isSafeInteger(acknowledgedSequence) ||
          acknowledgedSequence < sequence
        ) {
          throw new Error("Read ACK không hợp lệ.");
        }

        previewReadConfirmedRef.current.set(id, acknowledgedSequence);
        setListState((previous) => ({
          ...previous,
          items: previous.items.map((item) =>
            normalizeId(item.id) === id
              ? {
                  ...item,
                  lastReadSequence: Math.max(
                    item.lastReadSequence ?? 0,
                    acknowledgedSequence
                  ),
                  myLastReadSequence: Math.max(
                    item.myLastReadSequence ?? 0,
                    acknowledgedSequence
                  ),
                  unreadCount:
                    (item.lastMessageSequence ?? 0) <= acknowledgedSequence
                      ? 0
                      : item.unreadCount,
                }
              : item
          ),
        }));

        if (import.meta.env.DEV) {
          console.info("[Preview Seen] Read ACK success", {
            conversationId: id,
            sequence: acknowledgedSequence,
          });
        }
      } catch (error) {
        if (import.meta.env.DEV) {
          console.warn("[Preview Seen] Read ACK failed", id, error);
        }
      } finally {
        previewReadBusyRef.current.delete(id);
      }
    },
    [normalizedCurrentUserId, listKey]
  );

  // =====================================================
  // CONVERSATION DETAIL
  // =====================================================

  const [detailState, setDetailState] = useState({
    id: null,
    data: null,
    error: "",
  });

  // =====================================================
  // 5.7.8D3B - PERMISSION SYNC OVERLAY
  // =====================================================

  // REST detail là nguồn xác minh quyền.
  // Khi đang xác minh, UI không được tiếp tục
  // dùng quyền canSendMessage cũ.
  //
  // Overlay được tách khỏi listState và detailState
  // để các request cũ không ghi đè quyền mới.

  const [
    permissionOverrides,
    setPermissionOverrides,
  ] = useState({});

  const permissionOverridesRef =
    useRef(permissionOverrides);

  useEffect(() => {
    permissionOverridesRef.current =
      permissionOverrides;
  }, [permissionOverrides]);

  const detailStateRef = useRef(detailState);

  useEffect(() => {
    detailStateRef.current = detailState;
  }, [detailState]);

  const activeConversationIdRef =
    useRef(conversationId);

  useEffect(() => {
    activeConversationIdRef.current =
      conversationId;
  }, [conversationId]);

  const permissionTimersRef =
    useRef(new Map());

  const permissionControllersRef =
    useRef(new Map());

  const permissionGenerationsRef =
    useRef(new Map());

  // =====================================================
  // 5.7.8D3B - REFRESH ONE CONVERSATION PERMISSION
  // =====================================================

  const queuePermissionRefresh = useCallback(
    (rawId) => {
      const id = normalizeId(rawId);

      if (!id) return;

      // =============================================
      // 1. CANCEL PREVIOUS PENDING REQUEST
      // =============================================

      const previousTimer =
        permissionTimersRef.current.get(id);

      if (previousTimer !== undefined) {
        clearTimeout(previousTimer);

        permissionTimersRef.current.delete(id);
      }

      permissionControllersRef.current
        .get(id)
        ?.abort();

      permissionControllersRef.current.delete(id);

      // =============================================
      // 2. INVALIDATE OLD RESPONSES
      // =============================================

      const generation =
        (permissionGenerationsRef.current.get(id) || 0) + 1;

      permissionGenerationsRef.current.set(
        id,
        generation
      );

      // =============================================
      // 3. FAIL CLOSED WHILE CHECKING
      // =============================================

      setPermissionOverrides((previous) => ({
        ...previous,

        [id]: {
          status: "checking",
          canSendMessage: false,
          cannotSendReason:
            VERIFYING_PERMISSION_REASON,
        },
      }));

      // =============================================
      // 4. DEBOUNCED REST VERIFICATION
      // =============================================

      const timer = setTimeout(async () => {
        permissionTimersRef.current.delete(id);

        const controller = new AbortController();

        permissionControllersRef.current.set(
          id,
          controller
        );

        try {
          const detail =
            await getConversationById(rawId, {
              signal: controller.signal,
            });

          if (
            controller.signal.aborted ||
            permissionGenerationsRef.current.get(id) !==
              generation
          ) {
            return;
          }

          // =========================================
          // 5. VALIDATE RESPONSE
          // =========================================

          if (
            normalizeId(detail?.id) !== id ||
            typeof detail.canSendMessage !== "boolean"
          ) {
            throw new Error(
              "Dữ liệu quyền hội thoại không hợp lệ."
            );
          }

          const permission = {
            status: "resolved",
            canSendMessage:
              detail.canSendMessage,

            cannotSendReason:
              detail.cannotSendReason || "",
          };

          // =========================================
          // 6. UPDATE AUTHORITATIVE OVERLAY
          // =========================================

          setPermissionOverrides((previous) => ({
            ...previous,
            [id]: permission,
          }));

          // =========================================
          // 7. PATCH CONVERSATION LIST
          // =========================================

          // Không reset listKey, pagination, sort
          // hoặc lastMessageSequence.

          setListState((previous) => ({
            ...previous,

            items: previous.items.map((item) =>
              normalizeId(item.id) === id
                ? {
                    ...item,

                    canSendMessage:
                      detail.canSendMessage,

                    cannotSendReason:
                      detail.cannotSendReason || "",
                  }
                : item
            ),
          }));

          // =========================================
          // 8. PATCH CURRENT CHAT DETAIL
          // =========================================

          // Chỉ thay metadata quyền.
          // Không làm unmount MessagePanel.

          setDetailState((previous) => {
            if (
              !previous.data ||
              normalizeId(previous.id) !== id
            ) {
              return previous;
            }

            return {
              ...previous,

              data: {
                ...previous.data,

                canSendMessage:
                  detail.canSendMessage,

                cannotSendReason:
                  detail.cannotSendReason || "",
              },
            };
          });
        } catch (error) {
          if (
            controller.signal.aborted ||
            permissionGenerationsRef.current.get(id) !==
              generation
          ) {
            return;
          }

          // =========================================
          // 9. FAIL CLOSED IF REST FAILED
          // =========================================

          setPermissionOverrides((previous) => ({
            ...previous,

            [id]: {
              status: "error",
              canSendMessage: false,

              cannotSendReason:
                PERMISSION_SYNC_ERROR_REASON,
            },
          }));

          if (import.meta.env.DEV) {
            console.warn(
              "[WebChat] Permission refresh failed:",
              rawId,
              error
            );
          }
        } finally {
          if (
            permissionControllersRef.current.get(id) ===
            controller
          ) {
            permissionControllersRef.current.delete(id);
          }
        }
      }, PERMISSION_REFRESH_DELAY);

      permissionTimersRef.current.set(
        id,
        timer
      );
    },
    []
  );

  // =====================================================
  // 5.7.8D3B - CLEANUP PERMISSION REQUESTS
  // =====================================================

  useEffect(() => {
    const timers = permissionTimersRef.current;

    const controllers =
      permissionControllersRef.current;

    const generations =
      permissionGenerationsRef.current;

    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }

      timers.clear();

      for (const controller of controllers.values()) {
        controller.abort();
      }

      controllers.clear();
      generations.clear();
    };
  }, []);

  // =====================================================
  // 5.7.8D3B - APPLY PERMISSION OVERLAY
  // =====================================================

  function applyPermissionOverride(conversation) {
    if (!conversation) return null;

    const id = normalizeId(conversation.id);

    const override = permissionOverrides[id];

    if (!override) {
      return conversation;
    }

    return {
      ...conversation,

      canSendMessage:
        override.canSendMessage,

      cannotSendReason:
        override.cannotSendReason,
    };
  }

  // =====================================================
  // SELECTED CONVERSATION
  // =====================================================

  const detailReady =
    Boolean(conversationId) &&
    normalizeId(detailState.id) ===
      normalizeId(conversationId);

  const loadingDetail =
    Boolean(conversationId) && !detailReady;

  const detailError =
    detailReady ? detailState.error : "";

  const selectedConversation =
    detailReady && detailState.data
      ? applyPermissionOverride(
          toConversationViewModel(detailState.data)
        )
      : null;

  // =====================================================
  // 5.7.7 - ONLINE / OFFLINE PRESENCE
  // =====================================================

  // Theo dõi các hội thoại đang được tải.
  // Overlay quyền được áp dụng trước khi
  // đăng ký theo dõi Presence.

  const presenceTargets = [
    ...conversations.map(applyPermissionOverride),
    selectedConversation,
  ].filter(Boolean);

  const {
    getPresence,
  } = useConversationPresence(presenceTargets);

  // =====================================================
  // 5.7.8D3B - CONVERSATION LIST WITH PERMISSION
  // =====================================================

  const conversationsWithPresence =
    conversations.map((item) => {
      const view = applyPermissionOverride(
        toConversationViewModel(item)
      );

      return {
        ...view,

        online:
          view.canSendMessage === true
            ? getPresence(item.otherUserId)
            : null,
      };
    });

  // =====================================================
  // 5.7.8D3B - SELECTED CHAT WITH PERMISSION
  // =====================================================

  const selectedOnline =
    selectedConversation?.canSendMessage === true
      ? getPresence(
          selectedConversation.otherUserId
        )
      : null;

  // Giữ nguyên key MessagePanel theo ConversationId.
  // Đổi quyền không làm mất lịch sử tin nhắn.

  const selectedConversationWithPresence =
    selectedConversation
      ? {
          ...selectedConversation,
          online: selectedOnline,
        }
      : null;

  // =====================================================
  // INITIAL CONVERSATION LIST
  // =====================================================

  useEffect(() => {
    const controller = new AbortController();

    const generation =
      ++listGenerationRef.current;

    loadMoreControllerRef.current?.abort();

    loadMoreControllerRef.current = null;
    loadMoreBusyRef.current = false;

    async function loadFirstPage() {
      try {
        const data = await getMyConversations({
          page: 1,
          pageSize: PAGE_SIZE,
          signal: controller.signal,
        });

        if (
          controller.signal.aborted ||
          generation !== listGenerationRef.current
        ) {
          return;
        }

        if (
          !data ||
          !Array.isArray(data.items)
        ) {
          throw new Error(
            "Danh sách hội thoại không hợp lệ."
          );
        }

        const items = sortConversations(
          deduplicateConversations(data.items)
        );

        setListState({
          key: listKey,
          items,
          hasMore: Boolean(data.hasNextPage),
          nextPage: data.hasNextPage ? 2 : null,
          error: "",
        });
      } catch (error) {
        if (
          controller.signal.aborted ||
          generation !== listGenerationRef.current
        ) {
          return;
        }

        setListState({
          key: listKey,
          items: [],
          hasMore: false,
          nextPage: null,

          error:
            getConversationApiError(
              error,
              "Không thể tải hội thoại."
            ) || "Không thể tải hội thoại.",
        });
      }
    }

    void loadFirstPage();

    return () => {
      controller.abort();

      loadMoreControllerRef.current?.abort();

      listGenerationRef.current += 1;
    };
  }, [listKey]);

  // =====================================================
  // LOAD CONVERSATION DETAIL
  // =====================================================

  useEffect(() => {
    if (!conversationId) {
      return undefined;
    }

    const controller = new AbortController();
    let active = true;

    async function loadDetail() {
      try {
        const data = await getConversationById(
          conversationId,
          { signal: controller.signal }
        );

        if (
          !active ||
          controller.signal.aborted
        ) {
          return;
        }

        if (
          normalizeId(data?.id) !==
          normalizeId(conversationId)
        ) {
          throw new Error(
            "Dữ liệu hội thoại không hợp lệ."
          );
        }

        setDetailState({
          id: conversationId,
          data,
          error: "",
        });
      } catch (error) {
        if (
          !active ||
          controller.signal.aborted
        ) {
          return;
        }

        setDetailState({
          id: conversationId,
          data: null,

          error:
            getConversationApiError(
              error,
              "Không thể mở hội thoại."
            ) || "Không thể mở hội thoại.",
        });
      }
    }

    void loadDetail();

    return () => {
      active = false;
      controller.abort();
    };
  }, [conversationId]);

  // =====================================================
  // REALTIME CONVERSATION UPDATED
  // =====================================================

  // =====================================================
  // 5.8E3 - REALTIME LAST MESSAGE PREVIEW
  // =====================================================

  useEffect(() => {
    function handleMessageCreated(message) {
      const id = normalizeId(
        message?.conversationId
      );

      if (!id) {
        return;
      }

      // Cập nhật danh sách hội thoại hiện tại.
      setListState((previous) => {
        if (previous.key !== listKey) {
          return previous;
        }

        let changed = false;

        const items = previous.items.map((item) => {
          if (normalizeId(item.id) !== id) {
            return item;
          }

          const next = applyMessagePreview(
            item,
            message
          );

          if (next !== item) {
            changed = true;
          }

          return next;
        });

        if (!changed) {
          return previous;
        }

        return {
          ...previous,
          items: sortConversations(items),
        };
      });

      // Cập nhật metadata của hội thoại đang mở.
      // Không remount MessagePanel.
      setDetailState((previous) => {
        if (
          !previous.data ||
          normalizeId(previous.id) !== id
        ) {
          return previous;
        }

        const data = applyMessagePreview(
          previous.data,
          message
        );

        return data === previous.data
          ? previous
          : {
              ...previous,
              data,
            };
      });
    }

    return subscribe(
      "MessageCreated",
      handleMessageCreated
    );
  }, [subscribe, listKey]);

  useEffect(() => {
    let active = true;

    const pendingDetails = new Map();

    async function loadMissingConversation(id) {
      const normalizedId = normalizeId(id);

      if (pendingDetails.has(normalizedId)) {
        return;
      }

      const controller = new AbortController();

      pendingDetails.set(
        normalizedId,
        controller
      );

      try {
        const detail = await getConversationById(
          id,
          { signal: controller.signal }
        );

        if (
          !active ||
          controller.signal.aborted ||
          normalizeId(detail?.id) !== normalizedId
        ) {
          return;
        }

        setListState((previous) => {
          if (previous.key !== listKey) {
            return previous;
          }

          const existing = previous.items.find(
            (item) =>
              normalizeId(item.id) === normalizedId
          );

          if (existing) {
            return previous;
          }

          return {
            ...previous,

            items: sortConversations(
              deduplicateConversations([
                detail,
                ...previous.items,
              ])
            ),
          };
        });
      } catch (error) {
        if (
          !active ||
          controller.signal.aborted
        ) {
          return;
        }

        if (import.meta.env.DEV) {
          console.warn(
            "[WebChat] Không thể lấy hội thoại mới:",
            error
          );
        }
      } finally {
        pendingDetails.delete(normalizedId);
      }
    }

    function handleConversationUpdated(payload) {
      if (!payload?.conversationId) {
        return;
      }

      const normalizedId = normalizeId(
        payload.conversationId
      );

      const current = listStateRef.current;

      if (current.key !== listKey) {
        return;
      }

      const exists = current.items.some(
        (item) =>
          normalizeId(item.id) === normalizedId
      );

      if (!exists) {
        void loadMissingConversation(
          payload.conversationId
        );

        return;
      }

      // Cập nhật metadata tại chỗ.
      // Không reset danh sách khi có tin nhắn mới.

      setListState((previous) => {
        if (previous.key !== listKey) {
          return previous;
        }

        const items = previous.items.map(
          (item) => {
            if (
              normalizeId(item.id) !== normalizedId
            ) {
              return item;
            }

            return applyConversationUpdate(
              item,
              payload
            );
          }
        );

        return {
          ...previous,
          items: sortConversations(items),
        };
      });

      // Cập nhật hội thoại đang mở.

      setDetailState((previous) => {
        if (
          !previous.data ||
          normalizeId(previous.id) !== normalizedId
        ) {
          return previous;
        }

        return {
          ...previous,

          data: applyConversationUpdate(
            previous.data,
            payload
          ),
        };
      });
    }

    const unsubscribe = subscribe(
      "ConversationUpdated",
      handleConversationUpdated
    );

    return () => {
      active = false;
      unsubscribe();

      for (const controller of pendingDetails.values()) {
        controller.abort();
      }

      pendingDetails.clear();
    };
  }, [subscribe, listKey]);

  // =====================================================
  // 5.7.8D3B - REALTIME PERMISSION EVENTS
  // =====================================================

  useEffect(() => {
    // =============================================
    // CHECK CONVERSATION EXISTS IN CURRENT UI
    // =============================================

    function isKnownConversation(id) {
      if (
        normalizeId(
          activeConversationIdRef.current
        ) === id
      ) {
        return true;
      }

      return listStateRef.current.items.some(
        (item) =>
          normalizeId(item.id) === id
      );
    }

    // =============================================
    // CONVERSATION PERMISSION CHANGED
    // =============================================

    function onConversationPermissionChanged(payload) {
      const id = normalizeId(
        payload?.conversationId
      );

      if (!id || !isKnownConversation(id)) {
        return;
      }

      // Backend đã commit thay đổi quan hệ.
      // Khóa quyền cũ và tải lại từ REST.

      queuePermissionRefresh(
        payload.conversationId
      );
    }

    // =============================================
    // FRIENDSHIP CHANGED
    // =============================================

    function onFriendshipChanged(payload) {
      if (!normalizedCurrentUserId) {
        return;
      }

      const actorId = normalizeId(
        payload?.actorUserId
      );

      const targetId = normalizeId(
        payload?.targetUserId
      );

      // Chỉ xử lý quan hệ có liên quan
      // đến người đang đăng nhập.

      if (
        actorId !== normalizedCurrentUserId &&
        targetId !== normalizedCurrentUserId
      ) {
        return;
      }

      const otherUserId =
        actorId === normalizedCurrentUserId
          ? targetId
          : actorId;

      if (
        !otherUserId ||
        otherUserId === normalizedCurrentUserId
      ) {
        return;
      }

      const ids = new Set();

      // Tìm hội thoại với người có quan hệ thay đổi.

      for (const item of listStateRef.current.items) {
        if (
          normalizeId(item.otherUserId) ===
          otherUserId
        ) {
          ids.add(item.id);
        }
      }

      // Hội thoại đang mở có thể không nằm
      // trong trang đầu danh sách.

      const selectedDetail =
        detailStateRef.current;

      if (
        normalizeId(
          selectedDetail.data?.otherUserId
        ) === otherUserId &&
        normalizeId(selectedDetail.id) ===
          normalizeId(
            activeConversationIdRef.current
          )
      ) {
        ids.add(selectedDetail.id);
      }

      // Dùng Set để không gọi REST nhiều lần
      // cho cùng một hội thoại.

      for (const id of ids) {
        queuePermissionRefresh(id);
      }
    }

    // =============================================
    // SUBSCRIBE
    // =============================================

    const offPermission = subscribe(
      "ConversationPermissionChanged",
      onConversationPermissionChanged
    );

    const offFriendship = subscribe(
      "FriendshipChanged",
      onFriendshipChanged
    );

    return () => {
      offPermission();
      offFriendship();
    };
  }, [
    subscribe,
    normalizedCurrentUserId,
    queuePermissionRefresh,
  ]);

  // =====================================================
  // 5.7.8D3B - PERMISSION AFTER RECONNECT
  // =====================================================

  const lastPermissionSyncVersionRef =
    useRef(syncVersion);

  useEffect(() => {
    if (
      lastPermissionSyncVersionRef.current ===
      syncVersion
    ) {
      return;
    }

    lastPermissionSyncVersionRef.current =
      syncVersion;

    if (syncVersion === 0) {
      return;
    }

    // Các hội thoại từng thay đổi quyền
    // cần xác minh lại sau Reconnect.
    //
    // Danh sách hội thoại còn được đồng bộ
    // qua reconcileList phía dưới.

    const ids = new Set(
      Object.keys(
        permissionOverridesRef.current
      )
    );

    if (conversationId) {
      ids.add(conversationId);
    }

    for (const id of ids) {
      queuePermissionRefresh(id);
    }
  }, [
    syncVersion,
    conversationId,
    queuePermissionRefresh,
  ]);

  // =====================================================
  // 5.7.5 - SILENT REST RECONCILIATION
  // =====================================================

  useEffect(() => {
    if (syncVersion === 0 || !listReady) {
      return undefined;
    }

    const controller = new AbortController();
    let active = true;

    async function reconcileList() {
      const snapshot = listStateRef.current;

      if (snapshot.key !== listKey) {
        return;
      }

      const loadedPages =
        snapshot.nextPage !== null
          ? snapshot.nextPage - 1
          : Math.max(
              1,
              Math.ceil(
                snapshot.items.length / PAGE_SIZE
              )
            );

      const pagesToFetch = Math.min(
        Math.max(loadedPages, 1),
        20
      );

      const collected = [];

      let pageHasNext = false;
      let readPages = 0;

      try {
        for (
          let page = 1;
          page <= pagesToFetch;
          page += 1
        ) {
          const result = await getMyConversations({
            page,
            pageSize: PAGE_SIZE,
            signal: controller.signal,
          });

          if (
            !active ||
            controller.signal.aborted
          ) {
            return;
          }

          if (!Array.isArray(result?.items)) {
            throw new Error(
              "Danh sách hội thoại không hợp lệ."
            );
          }

          readPages += 1;

          collected.push(
            ...result.items
          );

          pageHasNext = Boolean(
            result.hasNextPage
          );

          if (!pageHasNext) {
            break;
          }
        }

        if (
          !active ||
          controller.signal.aborted
        ) {
          return;
        }

        setListState((previous) => {
          if (previous.key !== listKey) {
            return previous;
          }

          const byId = new Map(
            previous.items.map(
              (item) => [
                normalizeId(item.id),
                item,
              ]
            )
          );

          const incomingIds = new Set(
            collected.map(
              (item) =>
                normalizeId(item.id)
            )
          );

          const merged = collected.map((item) => {
            const current = byId.get(normalizeId(item.id));
            return mergeConversationSnapshot(current, item);
          });

          // Giữ những hội thoại đã tải nhưng
          // không nằm trong các trang vừa đối soát.

          for (const item of previous.items) {
            if (
              !incomingIds.has(
                normalizeId(item.id)
              )
            ) {
              merged.push(item);
            }
          }

          return {
            ...previous,

            items: sortConversations(
              deduplicateConversations(merged)
            ),

            error: "",
          };
        });

        setListSyncError(
          readPages === pagesToFetch &&
          pageHasNext &&
          pagesToFetch === 20
            ? "Một số hội thoại cũ có thể chưa được đối soát."
            : ""
        );
      } catch (error) {
        if (
          !active ||
          controller.signal.aborted
        ) {
          return;
        }

        console.warn(
          "[WebChat] Conversation sync failed:",
          error
        );

        setListSyncError(
          "Chưa đồng bộ được toàn bộ danh sách hội thoại."
        );
      }
    }

    void reconcileList();

    return () => {
      active = false;
      controller.abort();
    };
  }, [
    syncVersion,
    listKey,
    listReady,
  ]);

  // =====================================================
  // LOAD MORE CONVERSATIONS
  // =====================================================

  async function handleLoadMore() {
    if (
      loadMoreBusyRef.current ||
      loadingList ||
      !hasMore ||
      !nextPage
    ) {
      return;
    }

    const generation =
      listGenerationRef.current;

    const controller = new AbortController();

    loadMoreControllerRef.current =
      controller;

    loadMoreBusyRef.current = true;

    setLoadingMore(true);
    setLoadMoreError("");

    try {
      const data = await getMyConversations({
        page: nextPage,
        pageSize: PAGE_SIZE,
        signal: controller.signal,
      });

      if (
        controller.signal.aborted ||
        generation !== listGenerationRef.current
      ) {
        return;
      }

      if (
        !data ||
        !Array.isArray(data.items)
      ) {
        throw new Error(
          "Dữ liệu trang hội thoại không hợp lệ."
        );
      }

      setListState((previous) => {
        if (previous.key !== listKey) {
          return previous;
        }

        const items = sortConversations(
          deduplicateConversations([
            ...data.items.map((item) =>
              mergeConversationSnapshot(
                previous.items.find((existing) =>
                  normalizeId(existing.id) === normalizeId(item.id)
                ),
                item
              )
            ),
            ...previous.items,
          ])
        );

        return {
          ...previous,
          items,

          hasMore:
            Boolean(data.hasNextPage),

          nextPage:
            data.hasNextPage
              ? nextPage + 1
              : null,

          error: "",
        };
      });
    } catch (error) {
      if (
        controller.signal.aborted ||
        generation !== listGenerationRef.current
      ) {
        return;
      }

      setLoadMoreError(
        getConversationApiError(
          error,
          "Không thể tải thêm hội thoại."
        ) || "Không thể tải thêm hội thoại."
      );
    } finally {
      if (
        generation === listGenerationRef.current
      ) {
        loadMoreBusyRef.current = false;
        loadMoreControllerRef.current = null;

        setLoadingMore(false);
      }
    }
  }

  // =====================================================
  // UI EVENTS
  // =====================================================

  function handleSelectConversation(id) {
    if (!id) return;

    setNotice("");

    navigate(
      `/messenger/${encodeURIComponent(id)}`
    );
  }

  function handleBack() {
    setNotice("");

    navigate("/messenger");
  }

  function handleRefresh() {
    // Nếu người dùng làm mới Messenger,
    // đồng thời thử xác minh quyền của
    // hội thoại đang mở.

    if (conversationId) {
      queuePermissionRefresh(
        conversationId
      );
    }

    loadMoreControllerRef.current?.abort();

    setLoadMoreError("");
    setLoadingMore(false);

    setRefreshKey(
      (value) => value + 1
    );
  }

  function handleUnavailable(feature) {
    setNotice(
      `${feature} sẽ được triển khai ở bước tiếp theo.`
    );
  }

  const mobileChatOpen =
    Boolean(conversationId);

  // =====================================================
  // RENDER
  // =====================================================

  return (
    <main className="messenger-app">
      {/* =============================================
          CONVERSATION LIST
          ============================================= */}

      <div
        className={`messenger-conversation-column ${
          mobileChatOpen
            ? "mobile-hidden"
            : ""
        }`}
      >
        <ConversationList
          conversations={
            conversationsWithPresence
          }
          selectedId={
            conversationId || null
          }
          onSelect={
            handleSelectConversation
          }
          onCreateConversation={() =>
            navigate("/friends")
          }
          loading={loadingList}
          loadingMore={loadingMore}
          error={listError}
          hasMore={hasMore}
          onRefresh={handleRefresh}
          onLoadMore={handleLoadMore}
          onPreviewSeen={handlePreviewSeen}
          currentUserId={currentUserId}
        />

        {listSyncError && (
          <div
            role="status"
            style={{
              padding: "4px 14px",
              fontSize: 12,
              opacity: 0.75,
            }}
          >
            {listSyncError}
          </div>
        )}
      </div>

      {/* =============================================
          CHAT PANEL
          ============================================= */}

      <section
        className={`messenger-chat-column ${
          mobileChatOpen
            ? "mobile-open"
            : ""
        }`}
      >
        {!conversationId ? (
          // =========================================
          // NO CONVERSATION SELECTED
          // =========================================

          <div className="messenger-empty-state">
            <div className="empty-state-icon">
              <MessagesSquare size={42} />
            </div>

            <h2>
              Chào mừng đến WebChat
            </h2>

            <p>
              Xin chào,{" "}
              {user?.displayName ||
                user?.username ||
                "bạn"}!
              <br />
              Chọn một cuộc trò chuyện để bắt đầu.
            </p>

            <span>
              <MessageCircle size={15} />
              Dữ liệu được lưu trong SQL Server
            </span>
          </div>
        ) : loadingDetail ? (
          // =========================================
          // LOADING CONVERSATION DETAIL
          // =========================================

          <div
            className="messenger-empty-state"
            role="status"
          >
            <p>Đang mở hội thoại...</p>
          </div>
        ) : detailError ? (
          // =========================================
          // DETAIL ERROR
          // =========================================

          <div
            className="messenger-empty-state"
            role="alert"
          >
            <h2>
              Không thể mở hội thoại
            </h2>

            <p>{detailError}</p>

            <button
              type="button"
              onClick={handleBack}
            >
              Quay lại danh sách
            </button>
          </div>
        ) : selectedConversationWithPresence ? (
          <>
            {/* PHASE 5.8E2 - SYNC REST STATUS CURSORS */}
            <ConversationStatusBridge
              conversation={detailState.data}
            />

            {/* =====================================
                CHAT HEADER
                ===================================== */}

            <ChatHeader
              conversation={
                selectedConversationWithPresence
              }
              onBack={handleBack}
              onUnavailable={handleUnavailable}
            />

            {/* =====================================
                MESSAGE PANEL
                ===================================== */}

            <ConversationMessagesPanel
              key={
                selectedConversationWithPresence.id
              }
              conversation={
                selectedConversationWithPresence
              }
              currentUserId={currentUserId}
              onUnavailable={handleUnavailable}
            />
          </>
        ) : (
          <div className="messenger-empty-state">
            <p>
              Không có dữ liệu hội thoại.
            </p>
          </div>
        )}
      </section>

      {/* =============================================
          NOTIFICATION
          ============================================= */}

      {notice && (
        <div
          className="messenger-toast"
          role="status"
        >
          <span>{notice}</span>

          <button
            type="button"
            onClick={() => setNotice("")}
            aria-label="Đóng thông báo"
          >
            <X size={17} />
          </button>
        </div>
      )}
    </main>
  );
}
