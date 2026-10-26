
import {
  useEffect,
  useMemo,
  useState,
} from "react";

import { useChatRealtime } from "./useChatRealtime";

const MAX_FRIENDS_PER_PAGE = 50;

// =====================================================
// HELPERS
// =====================================================

function normalizeId(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function getAffectedUserIds(payload, allowed) {
  const actorId = normalizeId(
    payload?.actorUserId
  );

  const targetId = normalizeId(
    payload?.targetUserId
  );

  return [actorId, targetId].filter(
    (id) => allowed.has(id)
  );
}

// =====================================================
// FRIEND PRESENCE HOOK
// =====================================================

export function useFriendPresence(friendUserIds = []) {
  const {
    isConnected,
    syncVersion,
    subscribe,
    watchFriendPresence,
    unwatchFriendPresence,
  } = useChatRealtime();

  // =====================================================
  // NORMALIZE CURRENT PAGE USERS
  // =====================================================

  const idsKey = useMemo(() => {
    const unique = new Set();

    for (const rawId of friendUserIds) {
      const id = normalizeId(rawId);

      if (!id) continue;

      unique.add(id);

      if (unique.size >= MAX_FRIENDS_PER_PAGE) {
        break;
      }
    }

    return [...unique]
      .sort()
      .join("|");
  }, [friendUserIds]);

  // =====================================================
  // SESSION-SCOPED STATE
  // =====================================================

  const [presenceState, setPresenceState] =
    useState(() => ({
      sessionKey: "",
      statuses: new Map(),
    }));

  // Đổi key khi:
  // - SignalR Reconnect
  // - Danh sách bạn bè trên trang thay đổi
  //
  // Không hiển thị trạng thái từ phiên cũ.
  const sessionKey = isConnected
    ? `${syncVersion}:${idsKey}`
    : "";

  // =====================================================
  // WATCH FRIEND PRESENCE
  // =====================================================

  useEffect(() => {
    if (
      !isConnected ||
      !idsKey ||
      typeof watchFriendPresence !== "function" ||
      typeof unwatchFriendPresence !== "function"
    ) {
      return undefined;
    }

    let active = true;

    const ids = idsKey.split("|");

    const allowed = new Set(ids);

    // Chống Snapshot cũ ghi đè sự kiện mới.
    const revisions = new Map();

    // Những User bị thu hồi quyền theo dõi
    // trong phiên đăng ký hiện tại.
    const revokedUsers = new Set();

    // =================================================
    // UPDATE A USER'S STATUS
    // =================================================

    function updatePresence(userId, isOnline) {
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
    // REVOKE A USER'S STATUS
    // =================================================

    function revokePresence(userId) {
      if (
        !active ||
        !allowed.has(userId)
      ) {
        return;
      }

      // Bắt đầu từ đây, Snapshot đang chờ
      // không được phép khôi phục Online/Offline.
      revokedUsers.add(userId);

      revisions.set(
        userId,
        (revisions.get(userId) || 0) + 1
      );

      updatePresence(userId, null);
    }

    // =================================================
    // PRESENCE CHANGED
    // =================================================

    function handlePresenceChanged(payload) {
      if (!active) return;

      const userId = normalizeId(
        payload?.userId
      );

      if (!allowed.has(userId)) {
        return;
      }

      // 5.7.8D1:
      // Backend thông báo đã thu hồi quyền.
      //
      // accessRevoked=true KHÔNG có nghĩa
      // người dùng đang Offline.
      if (payload?.accessRevoked === true) {
        revokePresence(userId);
        return;
      }

      if (
        typeof payload?.isOnline !== "boolean" ||
        revokedUsers.has(userId)
      ) {
        return;
      }

      revisions.set(
        userId,
        (revisions.get(userId) || 0) + 1
      );

      updatePresence(
        userId,
        payload.isOnline
      );
    }

    // =================================================
    // FRIENDSHIP CHANGED
    // =================================================

    function handleFriendshipChanged(payload) {
      if (!active || !payload) return;

      const action = String(
        payload.action ?? ""
      ).toLowerCase();

      // Quan hệ mới được tạo không có nghĩa
      // cần xóa Presence đang hợp lệ.
      if (action === "created") {
        return;
      }

      // Removed/Blocked/Changed/Unblocked:
      // Đặt Presence về "chưa xác định".
      //
      // Backend không tiết lộ Block cụ thể
      // cho tài khoản bị chặn.
      for (
        const userId of getAffectedUserIds(
          payload,
          allowed
        )
      ) {
        revokePresence(userId);
      }
    }

    // =================================================
    // REGISTER EVENT HANDLERS
    // =================================================

    // Đăng ký trước khi gọi Watch để
    // không bỏ lỡ sự kiện khi đang lấy Snapshot.
    const unsubscribePresence = subscribe(
      "PresenceChanged",
      handlePresenceChanged
    );

    const unsubscribeFriendship = subscribe(
      "FriendshipChanged",
      handleFriendshipChanged
    );

    // =================================================
    // INITIAL WATCH
    // =================================================

    async function watch(userId) {
      const revisionAtStart =
        revisions.get(userId) || 0;

      try {
        const snapshot =
          await watchFriendPresence(userId);

        if (!active) {
          return;
        }

        if (
          normalizeId(snapshot?.userId) !== userId ||
          typeof snapshot?.isOnline !== "boolean"
        ) {
          throw new Error(
            "Friend Presence Snapshot không hợp lệ."
          );
        }

        // Khi đã mất quyền, không được sử dụng
        // phản hồi từ Watch cũ.
        if (revokedUsers.has(userId)) {
          return;
        }

        // Một PresenceChanged mới hơn Snapshot
        // luôn được ưu tiên.
        if (
          (revisions.get(userId) || 0) !==
          revisionAtStart
        ) {
          return;
        }

        updatePresence(
          userId,
          snapshot.isOnline
        );
      } catch (error) {
        if (!active) {
          return;
        }

        // Không hiển thị Offline giả
        // khi Backend từ chối xem Presence.
        revokePresence(userId);

        if (import.meta.env.DEV) {
          console.warn(
            "[Friend Presence] Watch failed:",
            userId,
            error?.message ?? error
          );
        }
      }
    }

    // Mỗi user chỉ có một Watch trên trang.
    for (const userId of ids) {
      void watch(userId);
    }

    // =================================================
    // CLEANUP
    // =================================================

    return () => {
      active = false;

      unsubscribePresence();
      unsubscribeFriendship();

      // Unwatch best-effort:
      // Backend cũng dọn toàn bộ connection
      // khi SignalR bị ngắt.
      for (const userId of ids) {
        void unwatchFriendPresence(userId);
      }
    };
  }, [
    isConnected,
    idsKey,
    sessionKey,
    subscribe,
    watchFriendPresence,
    unwatchFriendPresence,
  ]);

  // =====================================================
  // CURRENT VALID SESSION STATUSES
  // =====================================================

  const statuses =
    isConnected &&
    presenceState.sessionKey === sessionKey
      ? presenceState.statuses
      : new Map();

  // =====================================================
  // GET ONE USER'S PRESENCE
  // =====================================================

  function getPresence(userId) {
    const key = normalizeId(userId);

    if (
      !key ||
      !statuses.has(key)
    ) {
      // null:
      // - chưa lấy được trạng thái
      // - đang Reconnect
      // - mất quyền xem Presence
      //
      // Không tự suy luận Offline.
      return null;
    }

    return statuses.get(key);
  }

  return {
    getPresence,
    statusByUser: statuses,
  };
}
