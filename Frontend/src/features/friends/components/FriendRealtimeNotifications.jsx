
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { useNavigate } from "react-router-dom";
import {
  Check,
  UserRoundPlus,
  X,
} from "lucide-react";

import { useAuth } from "../../auth/hooks/useAuth";
import { useChatRealtime } from "../../realtime/hooks/useChatRealtime";

import "../../../styles/friend-notifications.css";

const MAX_VISIBLE_NOTICES = 3;
const MAX_REMEMBERED_EVENTS = 250;
const NOTICE_DURATION_MS = 6500;

function normalizeId(value) {
  return String(value ?? "").trim().toLowerCase();
}

export default function FriendRealtimeNotifications() {
  const navigate = useNavigate();

  const { user } = useAuth();
  const { subscribe } = useChatRealtime();

  const currentUserId = normalizeId(
    user?.id || user?.userId
  );

  const [notices, setNotices] = useState([]);

  const seenEventsRef = useRef(new Set());
  const timersRef = useRef(new Map());

  // =====================================================
  // DISMISS
  // =====================================================

  const dismissNotice = useCallback((eventId) => {
    const timer = timersRef.current.get(eventId);

    if (timer !== undefined) {
      window.clearTimeout(timer);
      timersRef.current.delete(eventId);
    }

    setNotices((previous) =>
      previous.filter(
        (notice) => notice.eventId !== eventId
      )
    );
  }, []);

  // =====================================================
  // DEDUPLICATION
  // =====================================================

  const rememberEvent = useCallback((eventId) => {
    if (!eventId) {
      return false;
    }

    const seen = seenEventsRef.current;

    if (seen.has(eventId)) {
      return false;
    }

    seen.add(eventId);

    // Không giữ EventId mãi mãi trong bộ nhớ.
    while (seen.size > MAX_REMEMBERED_EVENTS) {
      const oldest = seen.values().next().value;
      seen.delete(oldest);
    }

    return true;
  }, []);

  // =====================================================
  // ADD NOTICE
  // =====================================================

  const showNotice = useCallback(
    ({ eventId, type, title, message, path, actionLabel }) => {
      if (!rememberEvent(eventId)) {
        return;
      }

      const notice = {
        eventId,
        type,
        title,
        message,
        path,
        actionLabel,
      };

      setNotices((previous) => {
        const next = [...previous, notice];

        return next.slice(-MAX_VISIBLE_NOTICES);
      });

      const timer = window.setTimeout(() => {
        timersRef.current.delete(eventId);

        setNotices((previous) =>
          previous.filter(
            (item) => item.eventId !== eventId
          )
        );
      }, NOTICE_DURATION_MS);

      timersRef.current.set(eventId, timer);
    },
    [rememberEvent]
  );

  // =====================================================
  // LISTEN FRIEND REQUEST EVENTS
  // =====================================================

  useEffect(() => {
    if (!currentUserId) {
      return undefined;
    }

    function onFriendRequestChanged(payload) {
      if (!payload || !payload.eventId) {
        return;
      }

      const action = String(
        payload.action ?? ""
      ).toLowerCase();

      const senderId = normalizeId(
        payload.senderUserId
      );

      const receiverId = normalizeId(
        payload.receiverUserId
      );

      const actorId = normalizeId(
        payload.actorUserId
      );

      const eventId = normalizeId(payload.eventId);

      // =================================================
      // NEW REQUEST FOR CURRENT USER
      // =================================================

      if (
        action === "sent" &&
        receiverId === currentUserId &&
        senderId !== currentUserId &&
        actorId === senderId
      ) {
        showNotice({
          eventId,
          type: "request",
          title: "Lời mời kết bạn mới",
          message:
            "Có người vừa gửi cho bạn một lời mời kết bạn.",
          path: "/friends?tab=received",
          actionLabel: "Xem lời mời",
        });

        return;
      }

      // =================================================
      // MY REQUEST WAS ACCEPTED
      // =================================================

      if (
        action === "accepted" &&
        senderId === currentUserId &&
        receiverId !== currentUserId &&
        actorId === receiverId
      ) {
        showNotice({
          eventId,
          type: "accepted",
          title: "Lời mời đã được chấp nhận",
          message:
            "Hai bạn đã trở thành bạn bè trên WebChat.",
          path: "/friends",
          actionLabel: "Xem bạn bè",
        });
      }

      // Các action rejected/cancelled không tạo toast.
      // FriendshipChanged chỉ dùng để đồng bộ dữ liệu.
    }

    const unsubscribe = subscribe(
      "FriendRequestChanged",
      onFriendRequestChanged
    );

    return () => {
      unsubscribe();
    };
  }, [
    currentUserId,
    subscribe,
    showNotice,
  ]);

  // =====================================================
  // CLEANUP TIMERS ON UNMOUNT
  // =====================================================

  useEffect(() => {
    const timers = timersRef.current;

    return () => {
      for (const timer of timers.values()) {
        window.clearTimeout(timer);
      }

      timers.clear();
    };
  }, []);

  // =====================================================
  // OPEN NOTICE DESTINATION
  // =====================================================

  function openNotice(notice) {
    dismissNotice(notice.eventId);
    navigate(notice.path);
  }

  if (notices.length === 0) {
    return null;
  }

  return (
    <div
      className="webchat-friend-notices"
      role="region"
      aria-label="Thông báo kết bạn"
      aria-live="polite"
      aria-relevant="additions"
    >
      {notices.map((notice) => {
        const isAccepted =
          notice.type === "accepted";

        return (
          <article
            key={notice.eventId}
            className={`webchat-friend-notice ${
              isAccepted
                ? "webchat-friend-notice-accepted"
                : "webchat-friend-notice-request"
            }`}
          >
            <div className="webchat-friend-notice-icon">
              {isAccepted ? (
                <Check size={20} />
              ) : (
                <UserRoundPlus size={20} />
              )}
            </div>

            <div className="webchat-friend-notice-body">
              <strong>
                {notice.title}
              </strong>

              <p>
                {notice.message}
              </p>

              <button
                type="button"
                className="webchat-friend-notice-action"
                onClick={() => openNotice(notice)}
              >
                {notice.actionLabel}
              </button>
            </div>

            <button
              type="button"
              className="webchat-friend-notice-close"
              onClick={() =>
                dismissNotice(notice.eventId)
              }
              aria-label="Đóng thông báo"
              title="Đóng thông báo"
            >
              <X size={17} />
            </button>
          </article>
        );
      })}
    </div>
  );
}
