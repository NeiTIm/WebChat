
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { HubConnectionState } from "@microsoft/signalr";

import { useAuth } from "../auth/hooks/useAuth";
import { ChatRealtimeContext } from "./contexts/ChatRealtimeContext";

import {
  createChatConnection,
  getChatConnectionError,
} from "./api/chatConnection";

const STATUS = {
  DISCONNECTED: "disconnected",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  RECONNECTING: "reconnecting",
};


const REALTIME_EVENTS = [
  // =====================================================
  // 5.7 - MESSAGE REALTIME
  // =====================================================

  "MessageCreated",
  "ConversationUpdated",
  "ConversationPermissionChanged",
  "SyncRequired",

  // =====================================================
  // TYPING
  // =====================================================

  "TypingStarted",
  "TypingStopped",

  // =====================================================
  // 5.7.7 - PRESENCE
  // =====================================================

  "PresenceChanged",

  // =====================================================
  // 5.7.8B - FRIENDS REALTIME
  // =====================================================

  "FriendRequestChanged",
  "FriendshipChanged",

  // =====================================================
  // 5.8C - SEEN REALTIME
  // =====================================================

  "MessageReadUpdated",

  // =====================================================
  // 5.8D3 - DELIVERED REALTIME
  // =====================================================

  "MessageDeliveredUpdated",
];


function normalizeId(value) {
  return String(value ?? "").trim().toLowerCase();
}

export default function ChatRealtimeProvider({ children }) {
  const {
    user,
    isAuthenticated,
    isInitializing,
    isLoggingOut,
  } = useAuth();

  const userId = user?.id || user?.userId || null;

  const [connectionInfo, setConnectionInfo] = useState({
    userId: null,
    status: STATUS.DISCONNECTED,
    error: "",
  });

  const [syncInfo, setSyncInfo] = useState({
    userId: null,
    version: 0,
  });

  const managerRef = useRef(null);
  const subscribersRef = useRef(new Map());

  // =====================================================
  // SUBSCRIBE SIGNALR EVENTS
  // =====================================================

  const subscribe = useCallback((eventName, handler) => {
    if (
      !REALTIME_EVENTS.includes(eventName) ||
      typeof handler !== "function"
    ) {
      throw new Error(
        `SignalR event không hợp lệ: ${eventName}`
      );
    }

    let handlers = subscribersRef.current.get(eventName);

    if (!handlers) {
      handlers = new Set();
      subscribersRef.current.set(eventName, handlers);
    }

    handlers.add(handler);

    return () => {
      handlers.delete(handler);

      if (handlers.size === 0) {
        subscribersRef.current.delete(eventName);
      }
    };
  }, []);

  // =====================================================
  // SIGNALR CONNECTION LIFECYCLE
  // =====================================================

  useEffect(() => {
    if (
      isInitializing ||
      !isAuthenticated ||
      !userId ||
      isLoggingOut
    ) {
      return undefined;
    }

    let active = true;
    let startPromise = null;
    let needsReconciliation = false;

    const connection = createChatConnection(() => active);

    function updateStatus(status, error = "") {
      if (!active) return;

      setConnectionInfo({
        userId,
        status,
        error,
      });

      if (import.meta.env.DEV) {
        console.info("[WebChat SignalR]", status, error);
      }
    }

    function requestReconciliation() {
      if (!active) return;

      setSyncInfo((previous) => ({
        userId,
        version:
          previous.userId === userId
            ? previous.version + 1
            : 1,
      }));
    }

    // Đăng ký trước khi connection.start().
    for (const eventName of REALTIME_EVENTS) {
      connection.on(eventName, (payload) => {
        if (!active) return;

        if (eventName === "SyncRequired") {
          requestReconciliation();
        }

        const handlers =
          subscribersRef.current.get(eventName);

        if (!handlers) return;

        for (const handler of [...handlers]) {
          try {
            handler(payload);
          } catch (error) {
            console.error(
              `[SignalR] Handler ${eventName} failed:`,
              error
            );
          }
        }
      });
    }

    connection.onreconnecting((error) => {
      needsReconciliation = true;

      updateStatus(
        STATUS.RECONNECTING,
        error ? getChatConnectionError(error) : ""
      );
    });

    connection.onreconnected(() => {
      updateStatus(STATUS.CONNECTED);
      needsReconciliation = false;

      // REST reconciliation và Presence resubscribe.
      requestReconciliation();
    });

    connection.onclose((error) => {
      needsReconciliation = true;

      updateStatus(
        STATUS.DISCONNECTED,
        error ? getChatConnectionError(error) : ""
      );
    });

    async function startConnection() {
      if (!active) return;

      if (startPromise) {
        return startPromise;
      }

      if (
        connection.state !==
        HubConnectionState.Disconnected
      ) {
        return;
      }

      updateStatus(STATUS.CONNECTING);

      const promise = connection.start();
      startPromise = promise;

      try {
        await promise;

        if (!active) return;

        updateStatus(STATUS.CONNECTED);

        if (needsReconciliation) {
          needsReconciliation = false;
          requestReconciliation();
        }
      } catch (error) {
        if (!active) return;

        needsReconciliation = true;

        updateStatus(
          STATUS.DISCONNECTED,
          getChatConnectionError(error)
        );
      } finally {
        if (startPromise === promise) {
          startPromise = null;
        }
      }
    }

    managerRef.current = {
      userId,
      connection,
      start: startConnection,
    };

    void startConnection();

    return () => {
      active = false;

      if (managerRef.current?.connection === connection) {
        managerRef.current = null;
      }

      void connection.stop().catch((error) => {
        if (import.meta.env.DEV) {
          console.warn(
            "[SignalR] Stop failed:",
            error
          );
        }
      });
    };
  }, [
    userId,
    isAuthenticated,
    isInitializing,
    isLoggingOut,
  ]);

  // =====================================================
  // RECONNECT
  // =====================================================

  const reconnect = useCallback(async () => {
    const manager = managerRef.current;

    if (!manager) return;

    if (
      manager.connection.state !==
      HubConnectionState.Disconnected
    ) {
      return;
    }

    await manager.start();
  }, []);

  // =====================================================
  // INVOKE CONNECTED
  // =====================================================

  const invokeConnected = useCallback(
    async (methodName, request) => {
      const manager = managerRef.current;

      if (
        !manager ||
        manager.connection.state !==
          HubConnectionState.Connected
      ) {
        throw new Error("SignalR chưa kết nối.");
      }

      return manager.connection.invoke(
        methodName,
        request
      );
    },
    []
  );

  // =====================================================
  // SEND MESSAGE
  // =====================================================

  const sendMessage = useCallback(
    async ({
      conversationId,
      clientMessageId,
      content,
    }) => {
      if (
        !conversationId ||
        !clientMessageId ||
        typeof content !== "string" ||
        !content.trim() ||
        content.trim().length > 4000
      ) {
        throw new Error(
          "Dữ liệu tin nhắn không hợp lệ."
        );
      }

      const savedMessage = await invokeConnected(
        "SendMessage",
        {
          conversationId,
          clientMessageId,
          content: content.trim(),
        }
      );

      if (
        !savedMessage?.id ||
        !savedMessage?.conversationId ||
        !savedMessage?.clientMessageId
      ) {
        throw new Error(
          "Backend chưa xác nhận tin nhắn hợp lệ."
        );
      }

      return savedMessage;
    },
    [invokeConnected]
  );

  // =====================================================
  // TYPING
  // =====================================================

  const startTyping = useCallback(
    async (conversationId) => {
      if (!conversationId) return false;

      try {
        await invokeConnected(
          "StartTyping",
          { conversationId }
        );

        return true;
      } catch (error) {
        if (import.meta.env.DEV) {
          console.warn(
            "[WebChat Typing] Start failed:",
            error?.message ?? error
          );
        }

        return false;
      }
    },
    [invokeConnected]
  );

  const stopTyping = useCallback(
    async (conversationId) => {
      if (!conversationId) return false;

      try {
        await invokeConnected(
          "StopTyping",
          { conversationId }
        );

        return true;
      } catch (error) {
        if (import.meta.env.DEV) {
          console.warn(
            "[WebChat Typing] Stop failed:",
            error?.message ?? error
          );
        }

        return false;
      }
    },
    [invokeConnected]
  );

  // =====================================================
  // PRESENCE THEO CONVERSATION
  // =====================================================

  const watchPresence = useCallback(
    async (conversationId) => {
      if (!conversationId) {
        throw new Error(
          "ConversationId không hợp lệ."
        );
      }

      const result = await invokeConnected(
        "WatchPresence",
        { conversationId }
      );

      if (
        !result?.userId ||
        typeof result.isOnline !== "boolean"
      ) {
        throw new Error(
          "Backend trả về Presence không hợp lệ."
        );
      }

      return {
        userId: normalizeId(result.userId),
        isOnline: result.isOnline,
      };
    },
    [invokeConnected]
  );

  const unwatchPresence = useCallback(
    async (conversationId) => {
      if (!conversationId) return false;

      try {
        await invokeConnected(
          "UnwatchPresence",
          { conversationId }
        );

        return true;
      } catch (error) {
        if (import.meta.env.DEV) {
          console.warn(
            "[Presence] Unwatch failed:",
            error?.message ?? error
          );
        }

        return false;
      }
    },
    [invokeConnected]
  );

  // =====================================================
  // FRIEND PRESENCE - KHÔNG CẦN CONVERSATION
  // =====================================================

  const watchFriendPresence = useCallback(
    async (friendUserId) => {
      if (!friendUserId) {
        throw new Error(
          "Friend UserId không hợp lệ."
        );
      }

      const result = await invokeConnected(
        "WatchFriendPresence",
        { userId: friendUserId }
      );

      if (
        !result?.userId ||
        typeof result.isOnline !== "boolean"
      ) {
        throw new Error(
          "Backend trả về Friend Presence không hợp lệ."
        );
      }

      return {
        userId: normalizeId(result.userId),
        isOnline: result.isOnline,
      };
    },
    [invokeConnected]
  );

  const unwatchFriendPresence = useCallback(
    async (friendUserId) => {
      if (!friendUserId) return false;

      try {
        await invokeConnected(
          "UnwatchFriendPresence",
          { userId: friendUserId }
        );

        return true;
      } catch (error) {
        if (import.meta.env.DEV) {
          console.warn(
            "[Friend Presence] Unwatch failed:",
            error?.message ?? error
          );
        }

        return false;
      }
    },
    [invokeConnected]
  );

  // =====================================================
  // CONTEXT PUBLIC STATE
  // =====================================================

  const authenticated =
    isAuthenticated &&
    !isInitializing &&
    !isLoggingOut &&
    Boolean(userId);

  const matchesUser =
    authenticated &&
    connectionInfo.userId === userId;

  const status = !authenticated
    ? STATUS.DISCONNECTED
    : matchesUser
      ? connectionInfo.status
      : STATUS.CONNECTING;

  const error = matchesUser
    ? connectionInfo.error
    : "";

  const isConnected =
    status === STATUS.CONNECTED;

  const syncVersion =
    authenticated &&
    syncInfo.userId === userId
      ? syncInfo.version
      : 0;

  const value = useMemo(
    () => ({
      status,
      error,
      isConnected,
      syncVersion,
      reconnect,
      subscribe,
      sendMessage,
      startTyping,
      stopTyping,
      watchPresence,
      unwatchPresence,
      watchFriendPresence,
      unwatchFriendPresence,
    }),
    [
      status,
      error,
      isConnected,
      syncVersion,
      reconnect,
      subscribe,
      sendMessage,
      startTyping,
      stopTyping,
      watchPresence,
      unwatchPresence,
      watchFriendPresence,
      unwatchFriendPresence,
    ]
  );

  return (
    <ChatRealtimeContext.Provider value={value}>
      {children}
    </ChatRealtimeContext.Provider>
  );
}
