
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  AlertCircle,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Trash2,
} from "lucide-react";

import MessageList from "../../messages/components/MessageList";
import MessageInput from "../../messages/components/MessageInput";
import MessageReadSync from "../../messages/components/MessageReadSync";

import { useChatRealtime } from "../../realtime/hooks/useChatRealtime";
import { useConversationStatus } from "../hooks/useConversationStatus";

import { getConversationById } from "../api/conversationApi";

import {
  reconcileConversationMessages,
} from "../../realtime/api/messageReconciliation";

import {
  createClientMessageId,
  getConversationMessages,
  getMessageApiError,
} from "../../messages/api/messageApi";

// =====================================================
// CONFIGURATION
// =====================================================

const PAGE_SIZE = 20;
const MAX_CONFIRMED_CACHE = 100;
const PERMISSION_REFRESH_DELAY = 100;

// =====================================================
// HELPERS
// =====================================================

function normalizeId(value) {
  return String(value ?? "").trim().toLowerCase();
}

function formatTime(value) {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function toMessageViewModel(message, currentUserId) {
  return {
    ...message,

    sender:
      normalizeId(message.senderId) ===
      normalizeId(currentUserId)
        ? "me"
        : "other",

    time: formatTime(message.createdAtUtc),

    content: message.recalledAtUtc
      ? "Tin nhắn đã được thu hồi"
      : message.content || "",
  };
}

function mergeMessages(previous, additions) {
  const byId = new Map();
  const clientMessageKeys = new Map();

  for (const message of [...previous, ...additions]) {
    if (!message?.id) continue;

    const id = normalizeId(message.id);

    const clientKey = message.clientMessageId
      ? `${normalizeId(message.senderId)}:${normalizeId(
          message.clientMessageId
        )}`
      : null;

    if (
      clientKey &&
      clientMessageKeys.has(clientKey)
    ) {
      const oldId = clientMessageKeys.get(clientKey);

      if (oldId !== id) {
        byId.delete(oldId);
      }
    }

    byId.set(id, message);

    if (clientKey) {
      clientMessageKeys.set(clientKey, id);
    }
  }

  return [...byId.values()].sort(
    (a, b) => a.sequenceNumber - b.sequenceNumber
  );
}

function validateMessagesResponse(
  result,
  conversationId
) {
  if (
    !result ||
    !Array.isArray(result.items) ||
    normalizeId(result.conversationId) !==
      normalizeId(conversationId)
  ) {
    throw new Error(
      "Dữ liệu lịch sử tin nhắn không hợp lệ."
    );
  }
}

function validateConversationResponse(
  result,
  conversationId
) {
  if (
    !result ||
    normalizeId(result.id) !==
      normalizeId(conversationId) ||
    typeof result.canSendMessage !== "boolean"
  ) {
    throw new Error(
      "Dữ liệu quyền hội thoại không hợp lệ."
    );
  }
}

function isValidMessage(message, conversationId) {
  return (
    message &&
    typeof message.id === "string" &&
    normalizeId(message.conversationId) ===
      normalizeId(conversationId) &&
    typeof message.senderId === "string" &&
    Number.isSafeInteger(message.sequenceNumber) &&
    message.sequenceNumber > 0
  );
}

function isCanceled(error, controller) {
  return (
    controller.signal.aborted ||
    error?.code === "ERR_CANCELED"
  );
}

function getErrorMessage(error, fallback) {
  return getMessageApiError(error, fallback) || fallback;
}

function isSameClientMessage(
  savedMessage,
  pendingMessage,
  currentUserId
) {
  return Boolean(
    savedMessage &&
    pendingMessage &&
    savedMessage.clientMessageId &&
    normalizeId(savedMessage.clientMessageId) ===
      normalizeId(pendingMessage.clientMessageId) &&
    normalizeId(savedMessage.senderId) ===
      normalizeId(currentUserId)
  );
}

// =====================================================
// CONVERSATION MESSAGES PANEL
// =====================================================

export default function ConversationMessagesPanel({
  conversation,
  currentUserId,
  onUnavailable = () => {},
}) {
  const conversationId = conversation.id;

  // =====================================================
  // 5.8E3 - CONVERSATION STATUS STORE
  // =====================================================

  const {
    getConversationStatus,
    refreshConversation,
  } = useConversationStatus();

  const conversationStatus =
    getConversationStatus(conversationId);

  // Delivered ACK thuộc GlobalDeliverySync.
  // Read ACK thuộc MessageReadSync.
  // Panel chỉ phối hợp các component.

  // =====================================================
  // SIGNALR
  // =====================================================

  const {
    subscribe,
    sendMessage,
    isConnected,
    status,
    reconnect,
    syncVersion,
  } = useChatRealtime();

  // =====================================================
  // HISTORY
  // =====================================================

  const [history, setHistory] = useState({
    messages: [],
    loading: true,
    error: "",
    hasMore: false,
    nextBeforeSequence: null,
  });

  const [loadingOlder, setLoadingOlder] =
    useState(false);

  const [olderError, setOlderError] =
    useState("");

  const [refreshing, setRefreshing] =
    useState(false);

  const [syncing, setSyncing] =
    useState(false);

  const [syncError, setSyncError] =
    useState("");

  const [manualSyncKey, setManualSyncKey] =
    useState(0);

  // =====================================================
  // SEND / RETRY
  // =====================================================

  const [sending, setSending] =
    useState(false);

  const [sendError, setSendError] =
    useState("");

  const [retryMessage, setRetryMessage] =
    useState(null);

  // =====================================================
  // PERMISSION
  // =====================================================

  const [permission, setPermission] = useState({
    canSendMessage:
      conversation.canSendMessage === true,

    cannotSendReason:
      conversation.cannotSendReason || "",
  });

  const [checkingPermission, setCheckingPermission] =
    useState(false);

  const [permissionError, setPermissionError] =
    useState("");

  // =====================================================
  // REFS
  // =====================================================

  const mountedRef = useRef(false);

  const sendingRef = useRef(false);
  const olderBusyRef = useRef(false);
  const refreshingRef = useRef(false);

  const olderControllerRef = useRef(null);
  const refreshControllerRef = useRef(null);
  const permissionControllerRef = useRef(null);

  const permissionGenerationRef = useRef(0);
  const permissionRefreshTimerRef = useRef(null);

  const pendingMessageRef = useRef(null);

  const confirmedMessagesRef = useRef(
    new Map()
  );

  const historySnapshotRef = useRef(history);
  historySnapshotRef.current = history;

  const syncVersionSeenRef = useRef(0);

  // =====================================================
  // CONFIRMATION HELPERS
  // =====================================================

  const rememberConfirmation = useCallback(
    (message) => {
      if (!message?.clientMessageId) return;

      if (
        normalizeId(message.senderId) !==
        normalizeId(currentUserId)
      ) {
        return;
      }

      const key = normalizeId(
        message.clientMessageId
      );

      const confirmations =
        confirmedMessagesRef.current;

      confirmations.set(key, message);

      if (
        confirmations.size >
        MAX_CONFIRMED_CACHE
      ) {
        const oldestKey =
          confirmations.keys().next().value;

        confirmations.delete(oldestKey);
      }
    },
    [currentUserId]
  );

  const getConfirmation = useCallback(
    (clientMessageId) =>
      confirmedMessagesRef.current.get(
        normalizeId(clientMessageId)
      ) || null,
    []
  );

  // =====================================================
  // REFRESH CONVERSATION PERMISSION
  // =====================================================

  const refreshPermission = useCallback(async () => {
    if (!mountedRef.current) return;

    permissionControllerRef.current?.abort();

    const controller = new AbortController();

    permissionControllerRef.current = controller;

    const generation =
      ++permissionGenerationRef.current;

    setCheckingPermission(true);
    setPermissionError("");

    try {
      const result = await getConversationById(
        conversationId,
        { signal: controller.signal }
      );

      if (
        !mountedRef.current ||
        controller.signal.aborted ||
        generation !== permissionGenerationRef.current
      ) {
        return;
      }

      validateConversationResponse(
        result,
        conversationId
      );

      setPermission({
        canSendMessage: result.canSendMessage,
        cannotSendReason:
          result.cannotSendReason || "",
      });
    } catch (error) {
      if (
        !mountedRef.current ||
        isCanceled(error, controller) ||
        generation !== permissionGenerationRef.current
      ) {
        return;
      }

      setPermissionError(
        getErrorMessage(
          error,
          "Không thể cập nhật quyền hội thoại."
        )
      );
    } finally {
      if (
        mountedRef.current &&
        generation === permissionGenerationRef.current
      ) {
        setCheckingPermission(false);
      }

      if (
        permissionControllerRef.current === controller
      ) {
        permissionControllerRef.current = null;
      }
    }
  }, [conversationId]);

  // =====================================================
  // INITIAL MESSAGE HISTORY
  // =====================================================

  useEffect(() => {
    mountedRef.current = true;

    const controller = new AbortController();

    async function loadInitialMessages() {
      try {
        const result = await getConversationMessages(
          conversationId,
          {
            pageSize: PAGE_SIZE,
            signal: controller.signal,
          }
        );

        if (
          controller.signal.aborted ||
          !mountedRef.current
        ) {
          return;
        }

        validateMessagesResponse(
          result,
          conversationId
        );

        setHistory((previous) => ({
          ...previous,

          messages: mergeMessages(
            previous.messages,
            result.items
          ),

          loading: false,
          error: "",
          hasMore: Boolean(result.hasMore),

          nextBeforeSequence:
            result.nextBeforeSequence ?? null,
        }));
      } catch (error) {
        if (
          isCanceled(error, controller) ||
          !mountedRef.current
        ) {
          return;
        }

        setHistory((previous) => ({
          ...previous,
          loading: false,
          error: getErrorMessage(
            error,
            "Không thể tải lịch sử tin nhắn."
          ),
        }));
      }
    }

    void loadInitialMessages();

    return () => {
      mountedRef.current = false;

      controller.abort();

      olderControllerRef.current?.abort();
      refreshControllerRef.current?.abort();
      permissionControllerRef.current?.abort();

      if (permissionRefreshTimerRef.current !== null) {
        clearTimeout(permissionRefreshTimerRef.current);
        permissionRefreshTimerRef.current = null;
      }

      permissionGenerationRef.current += 1;
    };
  }, [conversationId]);

  // =====================================================
  // REALTIME MESSAGE CREATED
  // =====================================================

  useEffect(() => {
    function handleMessageCreated(message) {
      if (!isValidMessage(message, conversationId)) {
        return;
      }

      setHistory((previous) => ({
        ...previous,

        messages: mergeMessages(
          previous.messages,
          [message]
        ),
      }));

      rememberConfirmation(message);

      const pending = pendingMessageRef.current;

      if (
        isSameClientMessage(
          message,
          pending,
          currentUserId
        )
      ) {
        pendingMessageRef.current = null;

        setRetryMessage((previous) => {
          if (
            previous &&
            normalizeId(previous.clientMessageId) ===
              normalizeId(message.clientMessageId)
          ) {
            return null;
          }

          return previous;
        });

        setSendError("");
      }
    }

    return subscribe(
      "MessageCreated",
      handleMessageCreated
    );
  }, [
    conversationId,
    currentUserId,
    rememberConfirmation,
    subscribe,
  ]);

  // =====================================================
  // RECONCILE AFTER RECONNECT
  // =====================================================

  useEffect(() => {
    if (history.loading) return undefined;

    if (syncVersion === 0 && manualSyncKey === 0) {
      return undefined;
    }

    const syncKey =
      `${syncVersion}:${manualSyncKey}`;

    if (
      syncVersionSeenRef.current === syncKey
    ) {
      return undefined;
    }

    syncVersionSeenRef.current = syncKey;

    const controller = new AbortController();
    let active = true;

    async function run() {
      const snapshot =
        historySnapshotRef.current.messages;

      const knownSequence = snapshot.reduce(
        (max, message) =>
          Math.max(
            max,
            Number(message.sequenceNumber) || 0
          ),
        0
      );

      const pendingId =
        pendingMessageRef.current
          ?.clientMessageId ?? null;

      setSyncing(true);
      setSyncError("");

      try {
        const result =
          await reconcileConversationMessages({
            conversationId,
            knownSequence,
            pendingClientMessageId: pendingId,
            currentUserId,
            signal: controller.signal,
          });

        if (
          !active ||
          controller.signal.aborted
        ) {
          return;
        }

        setHistory((previous) => ({
          ...previous,

          messages: mergeMessages(
            previous.messages,
            result.messages
          ),
        }));

        for (const message of result.messages) {
          rememberConfirmation(message);
        }

        const currentPending =
          pendingMessageRef.current;

        const savedPending = currentPending
          ? result.messages.find(
              (message) =>
                isSameClientMessage(
                  message,
                  currentPending,
                  currentUserId
                )
            )
          : null;

        if (savedPending) {
          pendingMessageRef.current = null;

          setRetryMessage((previous) =>
            previous &&
            normalizeId(
              previous.clientMessageId
            ) ===
              normalizeId(
                savedPending.clientMessageId
              )
              ? null
              : previous
          );

          setSendError("");
        }

        if (!result.complete) {
          setSyncError(
            "Chưa đồng bộ đủ tin nhắn bị bỏ lỡ " +
            "(giới hạn 1.000 tin). " +
            "Hãy chọn Đồng bộ lại hoặc mở lại hội thoại."
          );
        }

        if (import.meta.env.DEV) {
          console.info(
            "[WebChat] Message reconciliation",
            {
              conversationId,
              recovered:
                result.messages.length,
              pagesFetched:
                result.pagesFetched,
              complete: result.complete,
              pendingFound:
                result.pendingFound,
            }
          );
        }
      } catch (error) {
        if (
          !active ||
          controller.signal.aborted
        ) {
          return;
        }

        setSyncError(
          "Không thể đồng bộ tin nhắn. Hãy thử lại."
        );

        console.warn(
          "[WebChat] Message reconciliation failed:",
          error
        );
      } finally {
        if (active) {
          setSyncing(false);
        }
      }
    }

    void run();

    return () => {
      active = false;
      controller.abort();
    };
  }, [
    conversationId,
    currentUserId,
    syncVersion,
    manualSyncKey,
    history.loading,
    rememberConfirmation,
  ]);

  // =====================================================
  // PERMISSION ON FOCUS / VISIBILITY
  // =====================================================

  useEffect(() => {
    function onFocus() {
      void refreshPermission();
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        void refreshPermission();
      }
    }

    void refreshPermission();

    window.addEventListener(
      "focus",
      onFocus
    );

    document.addEventListener(
      "visibilitychange",
      onVisibilityChange
    );

    return () => {
      window.removeEventListener(
        "focus",
        onFocus
      );

      document.removeEventListener(
        "visibilitychange",
        onVisibilityChange
      );
    };
  }, [refreshPermission]);

  // =====================================================
  // REALTIME PERMISSION
  // =====================================================

  useEffect(() => {
    function schedulePermissionRefresh() {
      if (!mountedRef.current) return;

      permissionControllerRef.current?.abort();

      permissionGenerationRef.current += 1;

      setPermission((previous) => ({
        ...previous,
        canSendMessage: false,
        cannotSendReason:
          "Đang xác minh lại quyền gửi tin nhắn...",
      }));

      setCheckingPermission(true);
      setPermissionError("");

      if (
        permissionRefreshTimerRef.current !== null
      ) {
        clearTimeout(
          permissionRefreshTimerRef.current
        );
      }

      permissionRefreshTimerRef.current =
        setTimeout(() => {
          permissionRefreshTimerRef.current = null;

          void refreshPermission();
        }, PERMISSION_REFRESH_DELAY);
    }

    function onConversationPermissionChanged(payload) {
      if (
        normalizeId(payload?.conversationId) !==
        normalizeId(conversationId)
      ) {
        return;
      }

      schedulePermissionRefresh();
    }

    function onFriendshipChanged(payload) {
      const actor =
        normalizeId(payload?.actorUserId);

      const target =
        normalizeId(payload?.targetUserId);

      const current =
        normalizeId(currentUserId);

      const other =
        normalizeId(conversation.otherUserId);

      if (!current || !other) return;

      const affectsThisConversation =
        (actor === current && target === other) ||
        (actor === other && target === current);

      if (affectsThisConversation) {
        schedulePermissionRefresh();
      }
    }

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

      if (
        permissionRefreshTimerRef.current !== null
      ) {
        clearTimeout(
          permissionRefreshTimerRef.current
        );

        permissionRefreshTimerRef.current = null;
      }
    };
  }, [
    subscribe,
    conversationId,
    conversation.otherUserId,
    currentUserId,
    refreshPermission,
  ]);

  // =====================================================
  // PERMISSION AFTER RECONNECT
  // =====================================================

  useEffect(() => {
    if (
      !isConnected ||
      syncVersion === 0
    ) {
      return;
    }

    void refreshPermission();
  }, [
    isConnected,
    syncVersion,
    refreshPermission,
  ]);

  // =====================================================
  // LOAD OLDER MESSAGES
  // =====================================================

  const handleLoadOlder = useCallback(async () => {
    if (
      olderBusyRef.current ||
      history.loading ||
      !history.hasMore ||
      history.nextBeforeSequence === null
    ) {
      return false;
    }

    olderBusyRef.current = true;

    const controller = new AbortController();

    olderControllerRef.current = controller;

    setLoadingOlder(true);
    setOlderError("");

    try {
      const result = await getConversationMessages(
        conversationId,
        {
          beforeSequence:
            history.nextBeforeSequence,
          pageSize: PAGE_SIZE,
          signal: controller.signal,
        }
      );

      if (
        controller.signal.aborted ||
        !mountedRef.current
      ) {
        return false;
      }

      validateMessagesResponse(
        result,
        conversationId
      );

      const oldCursor =
        history.nextBeforeSequence;

      const newCursor =
        result.nextBeforeSequence ?? null;

      if (
        result.hasMore &&
        (
          newCursor === null ||
          newCursor >= oldCursor
        )
      ) {
        throw new Error(
          "Cursor tin nhắn không hợp lệ."
        );
      }

      const existingIds = new Set(
        history.messages.map(
          (message) =>
            normalizeId(message.id)
        )
      );

      const hasNewOlderMessages =
        result.items.some(
          (message) =>
            !existingIds.has(
              normalizeId(message.id)
            )
        );

      setHistory((previous) => ({
        ...previous,

        messages: mergeMessages(
          previous.messages,
          result.items
        ),

        hasMore: Boolean(result.hasMore),

        nextBeforeSequence:
          result.hasMore ? newCursor : null,
      }));

      return hasNewOlderMessages;
    } catch (error) {
      if (
        isCanceled(error, controller) ||
        !mountedRef.current
      ) {
        return false;
      }

      setOlderError(
        getErrorMessage(
          error,
          "Không thể tải tin nhắn cũ."
        )
      );

      return false;
    } finally {
      olderBusyRef.current = false;

      if (
        olderControllerRef.current === controller
      ) {
        olderControllerRef.current = null;
      }

      if (mountedRef.current) {
        setLoadingOlder(false);
      }
    }
  }, [
    conversationId,
    history.loading,
    history.hasMore,
    history.nextBeforeSequence,
    history.messages,
  ]);

  // =====================================================
  // REFRESH LATEST MESSAGES
  // =====================================================

  async function refreshMessages() {
    if (refreshingRef.current) return;

    refreshingRef.current = true;
    setRefreshing(true);

    const controller = new AbortController();

    refreshControllerRef.current = controller;

    try {
      const result = await getConversationMessages(
        conversationId,
        {
          pageSize: PAGE_SIZE,
          signal: controller.signal,
        }
      );

      if (
        controller.signal.aborted ||
        !mountedRef.current
      ) {
        return;
      }

      validateMessagesResponse(
        result,
        conversationId
      );

      setHistory((previous) => ({
        ...previous,

        messages: mergeMessages(
          previous.messages,
          result.items
        ),

        loading: false,
        error: "",

        hasMore:
          previous.messages.length > 0
            ? previous.hasMore
            : Boolean(result.hasMore),

        nextBeforeSequence:
          previous.messages.length > 0
            ? previous.nextBeforeSequence
            : result.nextBeforeSequence ?? null,
      }));

      setOlderError("");
    } catch (error) {
      if (
        isCanceled(error, controller) ||
        !mountedRef.current
      ) {
        return;
      }

      setHistory((previous) => ({
        ...previous,
        loading: false,

        error: getErrorMessage(
          error,
          "Không thể làm mới lịch sử tin nhắn."
        ),
      }));
    } finally {
      refreshingRef.current = false;

      if (
        refreshControllerRef.current === controller
      ) {
        refreshControllerRef.current = null;
      }

      if (mountedRef.current) {
        setRefreshing(false);
      }
    }
  }

  // =====================================================
  // SEND MESSAGE / ACK / RETRY
  // =====================================================

  async function executeSend(messageToSend) {
    if (sendingRef.current) return;

    sendingRef.current = true;

    pendingMessageRef.current = messageToSend;

    setSending(true);
    setSendError("");

    try {
      const savedMessage = await sendMessage({
        conversationId,

        clientMessageId:
          messageToSend.clientMessageId,

        content:
          messageToSend.content,
      });

      if (!mountedRef.current) {
        return;
      }

      if (
        !isValidMessage(
          savedMessage,
          conversationId
        ) ||
        !isSameClientMessage(
          savedMessage,
          messageToSend,
          currentUserId
        )
      ) {
        throw new Error(
          "Xác nhận gửi tin nhắn không hợp lệ."
        );
      }

      rememberConfirmation(savedMessage);

      setHistory((previous) => ({
        ...previous,

        messages: mergeMessages(
          previous.messages,
          [savedMessage]
        ),
      }));

      if (
        isSameClientMessage(
          savedMessage,
          pendingMessageRef.current,
          currentUserId
        )
      ) {
        pendingMessageRef.current = null;
      }

      setRetryMessage(null);
      setSendError("");
    } catch (error) {
      if (!mountedRef.current) {
        return;
      }

      const confirmedMessage = getConfirmation(
        messageToSend.clientMessageId
      );

      if (confirmedMessage) {
        setHistory((previous) => ({
          ...previous,

          messages: mergeMessages(
            previous.messages,
            [confirmedMessage]
          ),
        }));

        if (
          normalizeId(
            pendingMessageRef.current?.clientMessageId
          ) ===
          normalizeId(
            messageToSend.clientMessageId
          )
        ) {
          pendingMessageRef.current = null;
        }

        setRetryMessage(null);
        setSendError("");

        return;
      }

      pendingMessageRef.current = messageToSend;
      setRetryMessage(messageToSend);

      setSendError(
        "Chưa xác nhận được trạng thái tin nhắn. " +
        "Tin có thể đã lưu thành công trên máy chủ. " +
        "Hãy kết nối lại và thử gửi lại " +
        "với cùng mã tin nhắn."
      );

      void refreshPermission();

      if (import.meta.env.DEV) {
        console.warn(
          "[WebChat] SignalR send not confirmed:",
          error
        );
      }
    } finally {
      sendingRef.current = false;

      if (mountedRef.current) {
        setSending(false);
      }
    }
  }

  // =====================================================
  // SEND HANDLERS
  // =====================================================

  function handleSend(content) {
    if (
      !permission.canSendMessage ||
      checkingPermission ||
      permissionError
    ) {
      setSendError(
        permission.cannotSendReason ||
        "Bạn hiện không thể gửi tin nhắn."
      );
      return;
    }

    if (!isConnected) {
      setSendError(
        "Kết nối realtime đang gián đoạn. " +
        "Vui lòng kết nối lại trước khi gửi."
      );
      return;
    }

    if (
      sendingRef.current ||
      retryMessage ||
      pendingMessageRef.current ||
      typeof content !== "string"
    ) {
      return;
    }

    const normalizedContent = content.trim();

    if (!normalizedContent) return;

    const request = {
      clientMessageId: createClientMessageId(),
      content: normalizedContent,
    };

    void executeSend(request);
  }

  function handleRetry() {
    if (
      !retryMessage ||
      sendingRef.current
    ) {
      return;
    }

    if (
      !permission.canSendMessage ||
      checkingPermission ||
      permissionError
    ) {
      setSendError(
        permission.cannotSendReason ||
        "Bạn không còn quyền gửi tin nhắn."
      );
      return;
    }

    if (!isConnected) {
      setSendError(
        "Chưa kết nối SignalR. " +
        "Vui lòng kết nối lại trước khi Retry."
      );
      return;
    }

    const alreadyConfirmed = getConfirmation(
      retryMessage.clientMessageId
    );

    if (alreadyConfirmed) {
      pendingMessageRef.current = null;
      setRetryMessage(null);
      setSendError("");

      setHistory((previous) => ({
        ...previous,

        messages: mergeMessages(
          previous.messages,
          [alreadyConfirmed]
        ),
      }));

      return;
    }

    void executeSend(retryMessage);
  }

  function handleDiscard() {
    if (sendingRef.current) return;

    pendingMessageRef.current = null;

    setRetryMessage(null);
    setSendError("");
  }

  // =====================================================
  // VIEW MODELS
  // =====================================================

  const messages = history.messages.map(
    (message) =>
      toMessageViewModel(
        message,
        currentUserId
      )
  );

  const canSendMessage =
    permission.canSendMessage &&
    !checkingPermission &&
    !permissionError &&
    isConnected;

  const cannotSendReason =
    permissionError ||
    (checkingPermission
      ? "Đang kiểm tra quyền gửi tin nhắn..."
      : permission.cannotSendReason ||
        "Hiện tại bạn không thể gửi tin nhắn.");

  // =====================================================
  // 5.8E3 - READ CURSOR
  // =====================================================

  const myLastReadSequence =
    conversationStatus?.myLastReadSequence;

  // Chỉ render Read Sync sau khi:
  // - Lịch sử tải thành công
  // - Không đang đồng bộ thiếu dữ liệu
  // - Đã có Conversation Status
  //
  // MessageReadSync tự kiểm tra thêm:
  // tab visible, focus, cuộn cuối và sequence.

  const canMountReadSync =
    !history.loading &&
    !history.error &&
    !syncing &&
    !syncError &&
    Boolean(conversationStatus) &&
    Number.isSafeInteger(
      conversation.lastMessageSequence
    ) &&
    Number.isSafeInteger(myLastReadSequence);

  // =====================================================
  // RENDER
  // =====================================================

  return (
    <>
      {/* HISTORY ERROR */}
      {history.error && (
        <div
          className="webchat-history-error"
          role="alert"
        >
          <div className="webchat-history-error-text">
            <AlertCircle size={19} />

            <div>
              <strong>Không thể tải tin nhắn</strong>
              <p>{history.error}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void refreshMessages()}
            disabled={refreshing}
          >
            {refreshing ? (
              <LoaderCircle
                size={16}
                className="webchat-spin"
              />
            ) : (
              <RefreshCw size={16} />
            )}

            {refreshing
              ? "Đang thử lại..."
              : "Thử lại"}
          </button>
        </div>
      )}

      {/* LOAD OLDER ERROR */}
      {olderError && (
        <div
          className="webchat-older-error"
          role="alert"
        >
          <AlertCircle size={16} />
          <span>{olderError}</span>

          <button
            type="button"
            disabled={loadingOlder}
            onClick={() =>
              void handleLoadOlder()
            }
          >
            {loadingOlder
              ? "Đang tải..."
              : "Thử lại"}
          </button>
        </div>
      )}

      {/* PERMISSION ERROR */}
      {permissionError && (
        <div
          className="webchat-permission-error"
          role="alert"
        >
          <AlertCircle size={16} />
          <span>{permissionError}</span>

          <button
            type="button"
            onClick={() =>
              void refreshPermission()
            }
            disabled={checkingPermission}
          >
            Kiểm tra lại
          </button>
        </div>
      )}

      {/* REALTIME CONNECTION STATUS */}
      {!isConnected && (
        <div
          className="webchat-permission-error"
          role="status"
        >
          <AlertCircle size={16} />

          <span>
            {status === "connecting"
              ? "Đang kết nối realtime..."
              : status === "reconnecting"
                ? "Đang kết nối lại realtime..."
                : "Mất kết nối realtime. " +
                  "Bạn vẫn có thể xem lịch sử tin nhắn."}
          </span>

          {status === "disconnected" && (
            <button
              type="button"
              onClick={() => void reconnect()}
            >
              Kết nối lại
            </button>
          )}
        </div>
      )}

      {/* RECONCILIATION */}
      {syncing && (
        <div
          className="webchat-sending-status"
          role="status"
        >
          <LoaderCircle
            size={15}
            className="webchat-spin"
          />
          <span>
            Đang đồng bộ tin nhắn bị bỏ lỡ...
          </span>
        </div>
      )}

      {syncError && !syncing && (
        <div
          className="webchat-history-error"
          role="alert"
        >
          <div className="webchat-history-error-text">
            <AlertCircle size={18} />
            <span>{syncError}</span>
          </div>

          <button
            type="button"
            onClick={() =>
              setManualSyncKey(
                (key) => key + 1
              )
            }
          >
            <RefreshCw size={16} />
            Đồng bộ lại
          </button>
        </div>
      )}

      {/* =================================================
          5.8E3 - MESSAGE LIST + SENT/DELIVERED/SEEN
          ================================================= */}

      {history.loading ? (
        <div
          className="webchat-messages-loading"
          role="status"
        >
          <LoaderCircle
            size={28}
            className="webchat-spin"
          />

          <strong>
            Đang tải tin nhắn
          </strong>

          <p>
            Đang lấy lịch sử cuộc trò chuyện...
          </p>
        </div>
      ) : (
        <>
          {/* MESSAGE LIST */}
          <MessageList
            conversation={conversation}
            messages={messages}
            conversationStatus={conversationStatus}
            hasMore={history.hasMore}
            loadingOlder={loadingOlder}
            onLoadOlder={handleLoadOlder}
          />

          {/* MESSAGE READ SYNC */}
          {canMountReadSync && (
            <MessageReadSync
              conversationId={conversationId}
              currentUserId={currentUserId}
              lastMessageSequence={
                conversation.lastMessageSequence
              }
              myLastReadSequence={
                myLastReadSequence
              }
              messages={messages}
              loading={history.loading}
              onReadConfirmed={refreshConversation}
            />
          )}
        </>
      )}

      {/* SEND ERROR / RETRY */}
      {sendError && (
        <div
          className="webchat-send-error"
          role="alert"
        >
          <div className="webchat-send-error-heading">
            <AlertCircle size={18} />

            <strong>
              {retryMessage
                ? "Tin nhắn chưa được xác nhận"
                : "Không thể gửi tin nhắn"}
            </strong>
          </div>

          <p>{sendError}</p>

          {retryMessage && (
            <div className="webchat-send-pending">
              <div className="webchat-send-pending-label">
                Nội dung chờ xác nhận:
              </div>

              <div className="webchat-send-pending-content">
                {retryMessage.content}
              </div>
            </div>
          )}

          {retryMessage && (
            <>
              <div className="webchat-send-error-actions">
                <button
                  type="button"
                  className="webchat-retry-button"
                  onClick={handleRetry}
                  disabled={
                    sending ||
                    !canSendMessage
                  }
                >
                  <RotateCcw size={15} />
                  Thử gửi lại
                </button>

                <button
                  type="button"
                  className="webchat-discard-button"
                  onClick={handleDiscard}
                  disabled={sending}
                >
                  <Trash2 size={15} />
                  Bỏ yêu cầu gửi
                </button>
              </div>

              <p
                style={{
                  marginTop: 8,
                  fontSize: 11,
                  opacity: 0.8,
                }}
              >
                Retry dùng lại ClientMessageId.
                Bỏ yêu cầu chỉ xóa trạng thái chờ
                trên giao diện, không xóa tin đã lưu
                trong SQL Server.
              </p>
            </>
          )}
        </div>
      )}

      {/* SENDING */}
      {sending && (
        <div
          className="webchat-sending-status"
          role="status"
        >
          <LoaderCircle
            size={15}
            className="webchat-spin"
          />

          <span>
            Đang gửi tin nhắn...
          </span>
        </div>
      )}

      {/* MESSAGE INPUT / READONLY */}
      {permission.canSendMessage ? (
        <MessageInput
          conversationId={conversationId}
          otherName={conversation.name}
          onSend={handleSend}
          onUnavailable={onUnavailable}
          sending={sending}
          disabled={
            Boolean(retryMessage) ||
            checkingPermission ||
            Boolean(permissionError) ||
            !isConnected
          }
        />
      ) : (
        <div
          className="webchat-readonly-status"
          role="status"
        >
          <ShieldAlert size={20} />

          <div className="webchat-readonly-content">
            <strong>
              Hội thoại chỉ đọc
            </strong>

            <span>
              {cannotSendReason}
            </span>
          </div>

          <button
            type="button"
            onClick={() =>
              void refreshPermission()
            }
            disabled={checkingPermission}
          >
            {checkingPermission ? (
              <LoaderCircle
                size={16}
                className="webchat-spin"
              />
            ) : (
              <RefreshCw size={16} />
            )}

            Kiểm tra lại
          </button>
        </div>
      )}
    </>
  );
}
