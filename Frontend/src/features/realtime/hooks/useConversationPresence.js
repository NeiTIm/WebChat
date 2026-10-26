
import {
  useEffect,
  useMemo,
  useState,
} from "react";

import { useChatRealtime } from "./useChatRealtime";

const MAX_WATCHED_CONVERSATIONS = 100;

// =====================================================
// HELPERS
// =====================================================

function normalizeId(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function normalizePresenceEvent(payload) {
  const userId = normalizeId(
    payload?.userId
  );

  if (!userId) {
    return null;
  }

  return {
    userId,
    isOnline: payload?.isOnline,
    accessRevoked:
      payload?.accessRevoked === true,
  };
}

// =====================================================
// CONVERSATION PRESENCE HOOK
// =====================================================

export function useConversationPresence(
  conversations = []
) {
  const {
    isConnected,
    syncVersion,
    subscribe,
    watchPresence,
    unwatchPresence,
  } = useChatRealtime();

  // =====================================================
  // BUILD AUTHORIZED WATCH TARGETS
  // =====================================================

  const watchTargets = useMemo(() => {
    const seenUsers = new Set();
    const result = [];

    for (
      const conversation of conversations ?? []
    ) {
      if (
        !conversation?.id ||
        !conversation?.otherUserId ||
        conversation.canSendMessage !== true
      ) {
        continue;
      }

      const userId = normalizeId(
        conversation.otherUserId
      );

      const conversationId = normalizeId(
        conversation.id
      );

      if (
        !userId ||
        !conversationId ||
        seenUsers.has(userId)
      ) {
        continue;
      }

      seenUsers.add(userId);

      result.push({
        conversationId,
        userId,
      });

      if (
        result.length >=
        MAX_WATCHED_CONVERSATIONS
      ) {
        break;
      }
    }

    return result;
  }, [conversations]);

  // Stable key: không rewatch chỉ vì component
  // render lại nhưng tập hội thoại không đổi.
  const targetsKey = watchTargets
    .map(
      (target) =>
        `${target.conversationId}:${target.userId}`
    )
    .sort()
    .join("|");

  // =====================================================
  // SESSION-SCOPED STATE
  // =====================================================

  const [presenceState, setPresenceState] =
    useState(() => ({
      sessionKey: "",
      statuses: new Map(),
    }));

  // Khi mất kết nối hoặc thay đổi quyền/tập
  // hội thoại, không sử dụng Presence cũ.
  const sessionKey = isConnected
    ? `${syncVersion}:${targetsKey}`
    : "";

  // =====================================================
  // WATCH + REALTIME UPDATES
  // =====================================================

  useEffect(() => {
    if (
      !isConnected ||
      !targetsKey
    ) {
      return undefined;
    }

    let active = true;

    const targets = targetsKey
      .split("|")
      .map((entry) => {
        const separator = entry.indexOf(":");

        return {
          conversationId:
            entry.slice(0, separator),
          userId:
            entry.slice(separator + 1),
        };
      });

    const allowedUsers = new Set(
      targets.map((target) => target.userId)
    );

    const targetsByConversation = new Map(
      targets.map((target) => [
        target.conversationId,
        target.userId,
      ])
    );

    const revisions = new Map();

    const revokedUsers = new Set();

    // =================================================
    // UPDATE ONE PRESENCE
    // =================================================

    function updatePresence(
      userId,
      isOnline
    ) {
      if (!active) return;

      setPresenceState((previous) => {
        const next =
          previous.sessionKey === sessionKey
            ? new Map(previous.statuses)
            : new Map();

        if (typeof isOnline === "boolean") {
          next.set(userId, isOnline);
        } else {
          next.delete(userId);
        }

        return {
          sessionKey,
          statuses: next,
        };
      });
    }

    // =================================================
    // REVOKE ONE USER
    // =================================================

    function revokePresence(userId) {
      if (
        !active ||
        !allowedUsers.has(userId)
      ) {
        return;
      }

      revokedUsers.add(userId);

      revisions.set(
        userId,
        (revisions.get(userId) || 0) + 1
      );

      // Không hiển thị Offline giả.
      updatePresence(userId, null);
    }

    // =================================================
    // PRESENCE CHANGED
    // =================================================

    function handlePresenceChanged(payload) {
      if (!active) return;

      const event =
        normalizePresenceEvent(payload);

      if (
        !event ||
        !allowedUsers.has(event.userId)
      ) {
        return;
      }

      if (event.accessRevoked) {
        revokePresence(event.userId);
        return;
      }

      if (
        typeof event.isOnline !== "boolean" ||
        revokedUsers.has(event.userId)
      ) {
        return;
      }

      revisions.set(
        event.userId,
        (revisions.get(event.userId) || 0) + 1
      );

      updatePresence(
        event.userId,
        event.isOnline
      );
    }

    // =================================================
    // FRIENDSHIP CHANGED
    // =================================================

    function handleFriendshipChanged(payload) {
      if (!active || !payload) {
        return;
      }

      const action = String(
        payload.action ?? ""
      ).toLowerCase();

      if (action === "created") {
        return;
      }

      // Actor hoặc target có thể là người
      // đối diện trong một hội thoại.
      const actorId = normalizeId(
        payload.actorUserId
      );

      const targetId = normalizeId(
        payload.targetUserId
      );

      if (allowedUsers.has(actorId)) {
        revokePresence(actorId);
      }

      if (allowedUsers.has(targetId)) {
        revokePresence(targetId);
      }
    }

    // =================================================
    // CONVERSATION PERMISSION CHANGED
    // =================================================

    function handlePermissionChanged(payload) {
      if (!active) return;

      const conversationId = normalizeId(
        payload?.conversationId
      );

      const userId = targetsByConversation.get(
        conversationId
      );

      if (!userId) {
        return;
      }

      // Permission đã thay đổi:
      // Không hiển thị trạng thái cũ.
      //
      // Hook sẽ watch lại khi danh sách/chi tiết
      // hội thoại được refresh hoặc khi Reconnect.
      revokePresence(userId);
    }

    // =================================================
    // REGISTER EVENTS BEFORE WATCH
    // =================================================

    const unsubscribePresence = subscribe(
      "PresenceChanged",
      handlePresenceChanged
    );

    const unsubscribeFriendship = subscribe(
      "FriendshipChanged",
      handleFriendshipChanged
    );

    const unsubscribePermission = subscribe(
      "ConversationPermissionChanged",
      handlePermissionChanged
    );

    // =================================================
    // INITIAL WATCH
    // =================================================

    async function registerWatch(target) {
      const revisionAtStart =
        revisions.get(target.userId) || 0;

      try {
        const snapshot =
          await watchPresence(
            target.conversationId
          );

        if (!active) {
          return;
        }

        if (
          normalizeId(snapshot?.userId) !==
            target.userId ||
          typeof snapshot?.isOnline !==
            "boolean"
        ) {
          throw new Error(
            "Conversation Presence Snapshot không hợp lệ."
          );
        }

        // Không ghi đè trạng thái đã bị thu hồi.
        if (
          revokedUsers.has(target.userId)
        ) {
          return;
        }

        // Không ghi đè PresenceChanged
        // đến sau khi Watch bắt đầu.
        if (
          (revisions.get(target.userId) || 0) !==
          revisionAtStart
        ) {
          return;
        }

        updatePresence(
          target.userId,
          snapshot.isOnline
        );
      } catch (error) {
        if (!active) {
          return;
        }

        revokePresence(target.userId);

        if (import.meta.env.DEV) {
          console.warn(
            "[Conversation Presence] Watch failed:",
            target.conversationId,
            error?.message ?? error
          );
        }
      }
    }

    for (const target of targets) {
      void registerWatch(target);
    }

    // =================================================
    // CLEANUP
    // =================================================

    return () => {
      active = false;

      unsubscribePresence();
      unsubscribeFriendship();
      unsubscribePermission();

      for (const target of targets) {
        void unwatchPresence(
          target.conversationId
        );
      }
    };
  }, [
    isConnected,
    syncVersion,
    targetsKey,
    sessionKey,
    subscribe,
    watchPresence,
    unwatchPresence,
  ]);

  // =====================================================
  // READ ONLY CURRENT SESSION
  // =====================================================

  const statusByUser =
    isConnected &&
    presenceState.sessionKey === sessionKey
      ? presenceState.statuses
      : new Map();

  // =====================================================
  // GET USER PRESENCE
  // =====================================================

  function getPresence(userId) {
    if (
      !isConnected ||
      !userId
    ) {
      return null;
    }

    const key = normalizeId(userId);

    if (!statusByUser.has(key)) {
      return null;
    }

    return statusByUser.get(key);
  }

  return {
    statusByUser,
    getPresence,
    isPresenceConnected: isConnected,
  };
}
