
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  Link,
  useNavigate,
  useSearchParams,
} from "react-router-dom";

import {
  ArrowLeft,
  Ban,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Mail,
  MessageCircle,
  RefreshCw,
  Search,
  ShieldOff,
  UserMinus,
  UserRoundPlus,
  UsersRound,
  X,
} from "lucide-react";

import {
  friendApi,
  getFriendError,
} from "../api/friendApi";

import {
  openPrivateConversation,
  getConversationApiError,
} from "../../conversations/api/conversationApi";

import { useFriendPresence } from
  "../../realtime/hooks/useFriendPresence";

import { useChatRealtime } from
  "../../realtime/hooks/useChatRealtime";

import "../../../styles/friends.css";
import "../../../styles/friends-enhanced.css";

// =====================================================
// CONSTANTS
// =====================================================

const VALID_TABS = [
  "friends",
  "received",
  "sent",
  "blocked",
];

const TABS = [
  {
    id: "friends",
    label: "Bạn bè",
    icon: UsersRound,
  },
  {
    id: "received",
    label: "Đã nhận",
    icon: Mail,
  },
  {
    id: "sent",
    label: "Đã gửi",
    icon: Clock3,
  },
  {
    id: "blocked",
    label: "Đã chặn",
    icon: Ban,
  },
];

const ACTION_LABELS = {
  accept: "Chấp nhận lời mời",
  reject: "Từ chối lời mời",
  cancel: "Hủy lời mời",
  remove: "Hủy kết bạn",
  block: "Chặn người dùng",
  unblock: "Bỏ chặn người dùng",
};

const EMPTY_MESSAGES = {
  friends: {
    title: "Bạn chưa có bạn bè",
    description:
      "Hãy khám phá người dùng và gửi lời mời để bắt đầu kết nối.",
  },
  received: {
    title: "Không có lời mời đang chờ",
    description:
      "Khi có người gửi lời mời kết bạn, bạn sẽ thấy tại đây.",
  },
  sent: {
    title: "Chưa gửi lời mời nào",
    description:
      "Những lời mời bạn đã gửi và đang chờ phản hồi sẽ xuất hiện ở đây.",
  },
  blocked: {
    title: "Danh sách chặn đang trống",
    description:
      "Những tài khoản bạn chặn sẽ được hiển thị tại đây.",
  },
};

// Gộp những sự kiện đến gần nhau.
const REALTIME_REFRESH_DELAY = 150;

// =====================================================
// HELPERS
// =====================================================

function getDisplayName(user) {
  return (
    user?.displayName ||
    user?.username ||
    "Người dùng"
  );
}

function getInitials(user) {
  return getDisplayName(user)
    .trim()
    .split(/\s+/)
    .slice(-2)
    .map((part) =>
      part.charAt(0).toUpperCase()
    )
    .join("");
}

async function fetchTabData(
  tab,
  page,
  pageSize,
  signal
) {
  switch (tab) {
    case "friends":
      return friendApi.getFriends(
        page,
        pageSize,
        signal
      );

    case "received":
      return friendApi.getReceived(
        page,
        pageSize,
        signal
      );

    case "sent":
      return friendApi.getSent(
        page,
        pageSize,
        signal
      );

    case "blocked":
      return friendApi.getBlocked(
        page,
        pageSize,
        signal
      );

    default:
      throw new Error("Tab không hợp lệ.");
  }
}

// =====================================================
// AVATAR
// =====================================================

function Avatar({ user, isOnline = null }) {
  const [failedUrl, setFailedUrl] =
    useState(null);

  const imageUrl = user?.avatarUrl;

  return (
    <div
      style={{
        position: "relative",
        flexShrink: 0,
      }}
    >
      <div className="friends-avatar">
        {imageUrl && failedUrl !== imageUrl ? (
          <img
            src={imageUrl}
            alt=""
            referrerPolicy="no-referrer"
            onError={() =>
              setFailedUrl(imageUrl)
            }
          />
        ) : (
          <span>{getInitials(user)}</span>
        )}
      </div>

      {isOnline === true && (
        <span
          aria-label="Đang hoạt động"
          title="Đang hoạt động"
          style={{
            position: "absolute",
            right: 0,
            bottom: 0,
            width: 12,
            height: 12,
            borderRadius: "50%",
            backgroundColor: "#22c55e",
            border: "2px solid #fff",
            boxSizing: "content-box",
          }}
        />
      )}
    </div>
  );
}

// =====================================================
// FRIEND CARD
// =====================================================

function FriendCard({
  item,
  tab,
  busy,
  onAction,
  onMessage,
  isOnline = null,
}) {
  const user =
    tab === "received"
      ? item.sender
      : tab === "sent"
        ? item.receiver
        : item;

  if (!user) return null;

  const name = getDisplayName(user);
  const requestId = item.id;
  const userId = user.userId;

  return (
    <article className="friends-user-card friends-enhanced-card">
      <Avatar
        user={user}
        isOnline={
          tab === "friends" ? isOnline : null
        }
      />

      <div className="friends-user-info">
        <h3>{name}</h3>

        <p>
          @{user.username || "unknown"}
        </p>

        {tab === "friends" && (
          <>
            <span className="friends-mini-status is-friend">
              <Check size={13} />
              Bạn bè
            </span>

            {typeof isOnline === "boolean" && (
              <span
                role="status"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  marginLeft: 8,
                  fontSize: 12,
                  color: isOnline
                    ? "#16a34a"
                    : "#94a3b8",
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    backgroundColor: isOnline
                      ? "#22c55e"
                      : "#94a3b8",
                  }}
                />
                {isOnline
                  ? "Đang hoạt động"
                  : "Ngoại tuyến"}
              </span>
            )}

            {user.bio && (
              <span className="friends-user-bio">
                {user.bio}
              </span>
            )}
          </>
        )}

        {tab === "received" && (
          <span className="friends-mini-status is-received">
            <Mail size={13} />
            Muốn kết bạn với bạn
          </span>
        )}

        {tab === "sent" && (
          <span className="friends-mini-status is-pending">
            <Clock3 size={13} />
            Đang chờ phản hồi
          </span>
        )}

        {tab === "blocked" && (
          <span className="friends-mini-status is-blocked">
            <Ban size={13} />
            Đã chặn
          </span>
        )}
      </div>

      <div className="friends-card-actions friends-enhanced-actions">
        {tab === "received" && (
          <>
            <button
              type="button"
              className="friends-action primary"
              disabled={busy || !requestId}
              onClick={() =>
                onAction("accept", requestId, name)
              }
            >
              <Check size={16} />
              Chấp nhận
            </button>

            <button
              type="button"
              className="friends-action neutral"
              disabled={busy || !requestId}
              onClick={() =>
                onAction("reject", requestId, name)
              }
            >
              <X size={16} />
              Từ chối
            </button>
          </>
        )}

        {tab === "sent" && (
          <button
            type="button"
            className="friends-action neutral"
            disabled={busy || !requestId}
            onClick={() =>
              onAction("cancel", requestId, name)
            }
          >
            <X size={16} />
            Hủy lời mời
          </button>
        )}

        {tab === "friends" && (
          <>
            <button
              type="button"
              className="friends-action primary"
              disabled={busy || !userId}
              onClick={() => onMessage(userId)}
            >
              <MessageCircle size={16} />
              Nhắn tin
            </button>

            <button
              type="button"
              className="friends-action neutral"
              disabled={busy || !userId}
              onClick={() =>
                onAction("remove", userId, name)
              }
            >
              <UserMinus size={16} />
              Hủy kết bạn
            </button>

            <button
              type="button"
              className="friends-action danger"
              disabled={busy || !userId}
              onClick={() =>
                onAction("block", userId, name)
              }
            >
              <Ban size={16} />
              Chặn
            </button>
          </>
        )}

        {tab === "blocked" && (
          <button
            type="button"
            className="friends-action neutral"
            disabled={busy || !userId}
            onClick={() =>
              onAction("unblock", userId, name)
            }
          >
            <ShieldOff size={16} />
            Bỏ chặn
          </button>
        )}
      </div>
    </article>
  );
}

// =====================================================
// CONFIRM MODAL
// =====================================================

function ConfirmModal({
  action,
  busy,
  onClose,
  onConfirm,
}) {
  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape" && !busy) {
        onClose();
      }
    }

    window.addEventListener(
      "keydown",
      handleKeyDown
    );

    return () => {
      window.removeEventListener(
        "keydown",
        handleKeyDown
      );
    };
  }, [busy, onClose]);

  if (!action) return null;

  const isDestructive = [
    "block",
    "remove",
    "reject",
    "cancel",
  ].includes(action.type);

  return (
    <div
      className="friends-modal-backdrop"
      onMouseDown={(event) => {
        if (
          event.target === event.currentTarget &&
          !busy
        ) {
          onClose();
        }
      }}
    >
      <div
        className="friends-modal friends-enhanced-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="friends-confirm-title"
        aria-describedby="friends-confirm-description"
      >
        <div
          className={`friends-modal-symbol ${
            isDestructive ? "danger" : "success"
          }`}
        >
          {isDestructive ? (
            <Ban size={23} />
          ) : (
            <Check size={23} />
          )}
        </div>

        <h2 id="friends-confirm-title">
          {ACTION_LABELS[action.type]}
        </h2>

        <p id="friends-confirm-description">
          Bạn có chắc muốn thực hiện thao tác này
          với{" "}
          <strong>
            {action.name || "người dùng"}
          </strong>
          ?
        </p>

        {action.type === "block" && (
          <p className="friends-modal-warning">
            Chặn sẽ đồng thời hủy kết bạn và các
            lời mời đang chờ giữa hai người.
          </p>
        )}

        {action.type === "remove" && (
          <p className="friends-modal-note">
            Hai người sẽ không còn trong danh sách
            bạn bè của nhau.
          </p>
        )}

        {action.type === "unblock" && (
          <p className="friends-modal-note">
            Bỏ chặn không tự động kết bạn lại.
          </p>
        )}

        <div className="friends-modal-actions">
          <button
            type="button"
            className="friends-action neutral"
            disabled={busy}
            onClick={onClose}
          >
            Quay lại
          </button>

          <button
            type="button"
            className={`friends-action ${
              isDestructive ? "danger" : "primary"
            }`}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? (
              <>
                <RefreshCw
                  size={16}
                  className="friends-spinning"
                />
                Đang xử lý...
              </>
            ) : (
              "Xác nhận"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// =====================================================
// FRIENDS PAGE
// =====================================================

export default function FriendsPage() {
  const navigate = useNavigate();

  const [
    searchParams,
    setSearchParams,
  ] = useSearchParams();

  const requestedTab = searchParams.get("tab");

  const tab = VALID_TABS.includes(requestedTab)
    ? requestedTab
    : "friends";

  const {
    subscribe,
    syncVersion,
  } = useChatRealtime();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [refreshKey, setRefreshKey] = useState(0);

  const [receivedCount, setReceivedCount] =
    useState(null);

  const [busy, setBusy] = useState(false);

  const [confirmAction, setConfirmAction] =
    useState(null);

  const refreshTimerRef = useRef(null);
  const previousSyncVersionRef = useRef(null);

  // =====================================================
  // 5.7.8B - REALTIME REFRESH
  // =====================================================

  const queueRealtimeRefresh = useCallback(() => {
    if (refreshTimerRef.current !== null) {
      clearTimeout(refreshTimerRef.current);
    }

    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;

      // Không xóa result ở đây.
      // Giữ dữ liệu cũ cho tới khi REST trả về.
      setRefreshKey((value) => value + 1);
    }, REALTIME_REFRESH_DELAY);
  }, []);

  useEffect(() => {
    // Cả hai sự kiện chỉ mang thông tin thay đổi.
    // Dữ liệu hiển thị vẫn lấy lại từ REST API.
    const stopRequest = subscribe(
      "FriendRequestChanged",
      queueRealtimeRefresh
    );

    const stopFriendship = subscribe(
      "FriendshipChanged",
      queueRealtimeRefresh
    );

    return () => {
      stopRequest();
      stopFriendship();

      if (refreshTimerRef.current !== null) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [subscribe, queueRealtimeRefresh]);

  // Đồng bộ lại sau Reconnect hoặc SyncRequired.
  useEffect(() => {
    if (previousSyncVersionRef.current === null) {
      previousSyncVersionRef.current = syncVersion;
      return;
    }

    if (
      previousSyncVersionRef.current !== syncVersion
    ) {
      previousSyncVersionRef.current = syncVersion;

      // Dùng microtask để tránh cập nhật state
      // đồng bộ ngay trong effect.
      Promise.resolve().then(() => {
        queueRealtimeRefresh();
      });
    }
  }, [syncVersion, queueRealtimeRefresh]);

  // =====================================================
  // LOAD CURRENT TAB + RECEIVED COUNT
  // =====================================================

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function load() {
      // Tải danh sách và badge song song.
      const countPromise =
        tab === "received"
          ? null
          : friendApi
              .getReceived(1, 1, controller.signal)
              .then((data) => data?.total ?? null)
              .catch(() => null);

      try {
        const data = await fetchTabData(
          tab,
          page,
          pageSize,
          controller.signal
        );

        if (
          !active ||
          controller.signal.aborted
        ) {
          return;
        }

        if (
          !data ||
          !Array.isArray(data.items) ||
          typeof data.total !== "number"
        ) {
          throw new Error(
            "Dữ liệu danh sách bạn bè không hợp lệ."
          );
        }

        // Nếu sau khi hủy bạn/chặn mà trang
        // hiện tại không còn kết quả, quay lại
        // trang gần nhất có dữ liệu.
        if (
          page > 1 &&
          data.items.length === 0
        ) {
          setPage((value) => Math.max(1, value - 1));
          return;
        }

        setResult({
          ...data,
          currentTab: tab,
        });

        if (tab === "received") {
          setReceivedCount(data.total);
        }

        setError("");
      } catch (err) {
        if (
          !active ||
          controller.signal.aborted
        ) {
          return;
        }

        const message =
          err?.message ===
          "Dữ liệu danh sách bạn bè không hợp lệ."
            ? err.message
            : getFriendError(err);

        setError(message);

        // Giữ dữ liệu cũ nếu request đồng bộ ngầm lỗi.
        // Người dùng có thể nhấn "Thử lại".
      } finally {
        if (active && !controller.signal.aborted) {
          setLoading(false);
        }
      }

      if (countPromise) {
        const count = await countPromise;

        if (active && !controller.signal.aborted) {
          setReceivedCount(count);
        }
      }
    }

    void load();

    return () => {
      active = false;
      controller.abort();
    };
  }, [
    tab,
    page,
    pageSize,
    refreshKey,
  ]);

  // =====================================================
  // NAVIGATION & MANUAL REFRESH
  // =====================================================

  function changeTab(nextTab) {
    if (busy || nextTab === tab) return;

    setSearchParams(
      nextTab === "friends"
        ? {}
        : { tab: nextTab }
    );

    setPage(1);
    setResult(null);
    setLoading(true);
    setError("");
    setSuccess("");
  }

  function refresh() {
    if (busy) return;

    setResult(null);
    setLoading(true);
    setError("");

    setRefreshKey((value) => value + 1);
  }

  function changePage(nextPage) {
    if (busy || nextPage < 1) return;

    setResult(null);
    setLoading(true);
    setError("");
    setPage(nextPage);
  }

  // =====================================================
  // OPEN PRIVATE CONVERSATION
  // =====================================================

  async function handleMessage(userId) {
    if (busy || !userId) return;

    setBusy(true);
    setError("");
    setSuccess("");

    try {
      const conversation =
        await openPrivateConversation(userId);

      if (!conversation?.id) {
        throw new Error(
          "API không trả về ConversationId hợp lệ."
        );
      }

      navigate(`/messenger/${conversation.id}`);
    } catch (err) {
      setError(
        getConversationApiError(
          err,
          "Không thể mở cuộc trò chuyện."
        )
      );
    } finally {
      setBusy(false);
    }
  }

  // =====================================================
  // FRIEND ACTIONS
  // =====================================================

  function requestAction(type, id, name) {
    if (busy || !id) return;

    setConfirmAction({
      type,
      id,
      name,
    });
  }

  function closeModal() {
    if (busy) return;
    setConfirmAction(null);
  }

  async function executeAction() {
    if (!confirmAction || busy) return;

    const action = confirmAction;

    setBusy(true);
    setError("");
    setSuccess("");

    try {
      switch (action.type) {
        case "accept":
          await friendApi.acceptRequest(action.id);
          break;

        case "reject":
          await friendApi.rejectRequest(action.id);
          break;

        case "cancel":
          await friendApi.cancelRequest(action.id);
          break;

        case "remove":
          await friendApi.removeFriend(action.id);
          break;

        case "block":
          await friendApi.blockUser(action.id);
          break;

        case "unblock":
          await friendApi.unblockUser(action.id);
          break;

        default:
          throw new Error("Thao tác không hợp lệ.");
      }

      setSuccess(
        `${ACTION_LABELS[action.type]} thành công.`
      );

      // Bản cũ gọi refresh() trong khi busy=true,
      // nên refresh bị bỏ qua. Ở đây cập nhật
      // refreshKey trực tiếp sau khi REST thành công.
      setPage(1);

      setRefreshKey((value) => value + 1);
    } catch (err) {
      setError(getFriendError(err));

      // Đồng bộ lại nếu quan hệ đã bị thay đổi
      // từ phía tài khoản khác.
      queueRealtimeRefresh();
    } finally {
      setConfirmAction(null);
      setBusy(false);
    }
  }

  // =====================================================
  // VIEW STATE
  // =====================================================

  const ready =
    result !== null &&
    result.currentTab === tab &&
    result.page === page &&
    result.pageSize === pageSize &&
    Array.isArray(result.items);

  const showLoading =
    loading || (!error && !ready);

  const empty = EMPTY_MESSAGES[tab];

  // Presence chỉ theo dõi bạn bè của trang hiện tại.
  const pageFriendIds = useMemo(() => {
    if (tab !== "friends" || !ready) {
      return [];
    }

    return result.items
      .map((item) => item.userId)
      .filter(Boolean);
  }, [tab, ready, result]);

  const { getPresence } =
    useFriendPresence(pageFriendIds);

  // =====================================================
  // RENDER
  // =====================================================

  return (
    <main className="friends-page friends-enhanced-page">
      <div className="friends-container">

        {/* TOPBAR */}
        <header className="friends-topbar">
          <Link
            to="/messenger"
            className="friends-back"
          >
            <ArrowLeft size={18} />
            Messenger
          </Link>

          <span className="friends-brand">
            <span>W</span>
            WebChat
          </span>
        </header>

        {/* HEADING */}
        <div className="friends-heading">
          <div className="friends-heading-icon">
            <UsersRound size={25} />
          </div>

          <div className="friends-heading-text">
            <h1>Quản lý bạn bè</h1>
            <p>
              Quản lý kết nối, lời mời kết bạn
              và quyền riêng tư của bạn.
            </p>
          </div>

          <Link
            to="/users/search"
            className="friends-find-button"
          >
            <Search size={17} />
            Tìm bạn mới
          </Link>
        </div>

        {/* RECEIVED COUNT */}
        <div className="friends-overview">
          <div className="friends-overview-text">
            <strong>
              {receivedCount === null
                ? "Lời mời kết bạn"
                : receivedCount > 0
                  ? `${receivedCount} lời mời đang chờ`
                  : "Không có lời mời đang chờ"}
            </strong>

            <p>
              {receivedCount === null
                ? "Xem tab Đã nhận để kiểm tra lời mời."
                : receivedCount > 0
                  ? "Bạn có lời mời kết bạn cần phản hồi."
                  : "Các lời mời mới sẽ xuất hiện tự động khi bạn đang kết nối."}
            </p>
          </div>

          <div className="friends-overview-actions">
            {receivedCount > 0 &&
              tab !== "received" && (
                <button
                  type="button"
                  className="friends-overview-link"
                  onClick={() => changeTab("received")}
                >
                  Xem lời mời
                </button>
              )}

            <button
              type="button"
              className="friends-refresh-button"
              disabled={loading || busy}
              onClick={refresh}
              title="Cập nhật danh sách"
            >
              <RefreshCw size={16} />
              Làm mới
            </button>
          </div>
        </div>

        {/* MAIN PANEL */}
        <section className="friends-panel">

          {/* TABS */}
          <div
            className="friends-tabs friends-enhanced-tabs"
            role="tablist"
            aria-label="Danh mục bạn bè"
          >
            {TABS.map((item) => {
              const Icon = item.icon;
              const selected = tab === item.id;

              return (
                <button
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  key={item.id}
                  className={`friends-tab ${
                    selected ? "active" : ""
                  }`}
                  disabled={busy}
                  onClick={() => changeTab(item.id)}
                >
                  <Icon size={17} />
                  <span>{item.label}</span>

                  {item.id === "received" &&
                    receivedCount > 0 && (
                      <span className="friends-count-badge">
                        {receivedCount > 99
                          ? "99+"
                          : receivedCount}
                      </span>
                    )}
                </button>
              );
            })}
          </div>

          {/* PANEL HEADER */}
          <div className="friends-panel-header">
            <div>
              <h2>
                {
                  TABS.find(
                    (item) => item.id === tab
                  )?.label
                }
              </h2>

              {ready && (
                <p className="friends-panel-subtitle">
                  Tổng cộng {result.total} mục
                </p>
              )}
            </div>

            <label className="friends-page-size">
              <span>Hiển thị</span>

              <select
                value={pageSize}
                disabled={busy}
                onChange={(event) => {
                  setPageSize(
                    Number(event.target.value)
                  );
                  setPage(1);
                  setResult(null);
                  setLoading(true);
                  setError("");
                }}
                aria-label="Số kết quả trên một trang"
              >
                <option value={20}>20</option>
                <option value={50}>50</option>
              </select>
            </label>
          </div>

          {/* SUCCESS */}
          {success && (
            <div
              className="friends-alert success friends-enhanced-alert"
              role="status"
            >
              <Check size={18} />
              <span>{success}</span>

              <button
                type="button"
                className="friends-dismiss-button"
                onClick={() => setSuccess("")}
                aria-label="Đóng thông báo"
              >
                <X size={16} />
              </button>
            </div>
          )}

          {/* ERROR */}
          {error && (
            <div
              className="friends-alert error friends-enhanced-alert"
              role="alert"
            >
              <span>{error}</span>

              <button
                type="button"
                onClick={refresh}
                disabled={busy}
              >
                Thử lại
              </button>
            </div>
          )}

          {/* CONTENT */}
          {showLoading ? (
            <div
              className="friends-empty"
              role="status"
            >
              <div className="loading-spinner" />
              <p>Đang tải dữ liệu...</p>
            </div>
          ) : error ? (
            <div className="friends-empty">
              <p>
                Không thể cập nhật danh sách.
                Hãy nhấn Thử lại.
              </p>
            </div>
          ) : ready &&
            result.items.length === 0 ? (
            <div className="friends-empty friends-enhanced-empty">
              {tab === "received" ? (
                <Mail size={38} />
              ) : tab === "blocked" ? (
                <ShieldOff size={38} />
              ) : (
                <UsersRound size={38} />
              )}

              <h3>{empty.title}</h3>
              <p>{empty.description}</p>

              {tab === "friends" && (
                <Link
                  to="/users/search"
                  className="friends-empty-link"
                >
                  <UserRoundPlus size={16} />
                  Khám phá người dùng
                </Link>
              )}

              {tab === "sent" && (
                <Link
                  to="/users/search"
                  className="friends-empty-link"
                >
                  <Search size={16} />
                  Tìm người để kết bạn
                </Link>
              )}
            </div>
          ) : ready ? (
            <>
              {/* LIST */}
              <div className="friends-list">
                {result.items.map((item) => (
                  <FriendCard
                    key={item.id || item.userId}
                    item={item}
                    tab={tab}
                    busy={busy}
                    onAction={requestAction}
                    onMessage={handleMessage}
                    isOnline={
                      tab === "friends"
                        ? getPresence(item.userId)
                        : null
                    }
                  />
                ))}
              </div>

              {/* PAGINATION */}
              <div className="friends-list-footer friends-enhanced-footer">
                <span>
                  Tổng cộng: {result.total}
                </span>

                {result.totalPages > 1 && (
                  <div className="friends-pagination">
                    <button
                      type="button"
                      disabled={
                        !result.hasPreviousPage ||
                        busy
                      }
                      aria-label="Trang trước"
                      onClick={() =>
                        changePage(page - 1)
                      }
                    >
                      <ChevronLeft size={18} />
                    </button>

                    <span>
                      {page} / {result.totalPages}
                    </span>

                    <button
                      type="button"
                      disabled={
                        !result.hasNextPage ||
                        busy
                      }
                      aria-label="Trang sau"
                      onClick={() =>
                        changePage(page + 1)
                      }
                    >
                      <ChevronRight size={18} />
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : null}
        </section>
      </div>

      {/* CONFIRM MODAL */}
      {confirmAction && (
        <ConfirmModal
          action={confirmAction}
          busy={busy}
          onClose={closeModal}
          onConfirm={executeAction}
        />
      )}
    </main>
  );
}
