import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  Ban,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Mail,
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
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

// =====================================================
// AVATAR
// =====================================================

function Avatar({ user }) {
  const [failedUrl, setFailedUrl] = useState(null);

  const imageUrl = user?.avatarUrl;
  const initials = getInitials(user);

  return (
    <div className="friends-avatar">
      {imageUrl && failedUrl !== imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(imageUrl)}
        />
      ) : (
        <span>{initials}</span>
      )}
    </div>
  );
}

// =====================================================
// USER CARD
// =====================================================

function FriendCard({
  item,
  tab,
  busy,
  onAction,
}) {
  const user =
    tab === "received"
      ? item.sender
      : tab === "sent"
        ? item.receiver
        : item;

  if (!user) {
    return null;
  }

  const name = getDisplayName(user);

  // FriendRequests sử dụng item.id làm RequestId.
  // Friendships/Blocks sử dụng user.userId.
  const requestId = item.id;
  const userId = user.userId;

  return (
    <article className="friends-user-card friends-enhanced-card">
      <Avatar user={user} />

      <div className="friends-user-info">
        <h3>{name}</h3>

        <p>@{user.username || "unknown"}</p>

        {tab === "friends" && (
          <>
            <span className="friends-mini-status is-friend">
              <Check size={13} />
              Bạn bè
            </span>

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

    window.addEventListener("keydown", handleKeyDown);

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
  const [searchParams, setSearchParams] =
    useSearchParams();

  const requestedTab = searchParams.get("tab");

  const tab = VALID_TABS.includes(requestedTab)
    ? requestedTab
    : "friends";

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // API
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  // Pending badge
  const [receivedCount, setReceivedCount] =
    useState(null);

  // Actions
  const [busy, setBusy] = useState(false);
  const [confirmAction, setConfirmAction] =
    useState(null);

  const [success, setSuccess] = useState("");

  // =====================================================
  // LOAD TAB + PENDING COUNT
  // =====================================================

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function load() {
      try {
        let data;

        if (tab === "friends") {
          data = await friendApi.getFriends(
            page,
            pageSize,
            controller.signal
          );
        } else if (tab === "received") {
          data = await friendApi.getReceived(
            page,
            pageSize,
            controller.signal
          );
        } else if (tab === "sent") {
          data = await friendApi.getSent(
            page,
            pageSize,
            controller.signal
          );
        } else {
          data = await friendApi.getBlocked(
            page,
            pageSize,
            controller.signal
          );
        }

        if (!active || controller.signal.aborted) {
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

        // Nếu xóa bản ghi cuối trang, trở về trang trước.
        if (page > 1 && data.items.length === 0) {
          setPage((value) => value - 1);
          return;
        }

        if (tab === "received") {
          setReceivedCount(data.total);
        }

        setResult({
          ...data,
          currentTab: tab,
        });

        setError("");
      } catch (err) {
        if (!active || controller.signal.aborted) {
          return;
        }

        setResult(null);

        if (
          err.message ===
          "Dữ liệu danh sách bạn bè không hợp lệ."
        ) {
          setError(err.message);
        } else {
          setError(getFriendError(err));
        }
      } finally {
        if (active && !controller.signal.aborted) {
          setLoading(false);
        }
      }

      // Khi đang ở tab khác, truy vấn thêm tổng số
      // lời mời chờ. Không tải toàn bộ danh sách.
      if (
        tab !== "received" &&
        active &&
        !controller.signal.aborted
      ) {
        try {
          const received = await friendApi.getReceived(
            1,
            20,
            controller.signal
          );

          if (active && !controller.signal.aborted) {
            setReceivedCount(
              typeof received?.total === "number"
                ? received.total
                : null
            );
          }
        } catch {
          if (active && !controller.signal.aborted) {
            setReceivedCount(null);
          }
        }
      }
    }

    Promise.resolve().then(() => {
      if (!active) return;

      setLoading(true);
      setError("");
      setResult(null);

      load();
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, [tab, page, pageSize, refreshKey]);

  // =====================================================
  // EVENTS
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
    setError("");
    setSuccess("");
  }

  function refresh() {
    if (busy) return;

    setResult(null);
    setError("");
    setRefreshKey((value) => value + 1);
  }

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

  // =====================================================
  // EXECUTE ACTION
  // =====================================================

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
          return;
      }

      setSuccess(
        `${ACTION_LABELS[action.type]} thành công.`
      );

      setConfirmAction(null);
      setPage(1);
      refresh();
    } catch (err) {
      setError(getFriendError(err));

      setConfirmAction(null);
      setPage(1);
      refresh();
    } finally {
      setBusy(false);
    }
  }

  // =====================================================
  // RENDER STATE
  // =====================================================

  const ready =
    !loading &&
    !error &&
    result !== null &&
    result.currentTab === tab &&
    result.page === page &&
    result.pageSize === pageSize &&
    Array.isArray(result.items);

  const empty = EMPTY_MESSAGES[tab];

  const showLoading =
    loading || (!error && !ready);

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

        {/* PAGE HEADING */}
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

        {/* INFORMATION STRIP */}
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
                  : "Các lời mời mới sẽ xuất hiện trong tab Đã nhận khi bạn cập nhật trang."}
            </p>
          </div>

          <div className="friends-overview-actions">
            {receivedCount > 0 &&
              tab !== "received" && (
                <button
                  type="button"
                  className="friends-overview-link"
                  onClick={() =>
                    changeTab("received")
                  }
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
                  onClick={() =>
                    changeTab(item.id)
                  }
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

          {/* LOADING */}
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
                Không thể tải danh sách.
                Hãy nhấn Thử lại.
              </p>
            </div>
          ) : ready && result.items.length === 0 ? (

            /* EMPTY */
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

            /* LIST + PAGINATION */
            <>
              <div className="friends-list">
                {result.items.map((item) => (
                  <FriendCard
                    key={
                      item.id ||
                      item.userId
                    }
                    item={item}
                    tab={tab}
                    busy={busy}
                    onAction={requestAction}
                  />
                ))}
              </div>

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
                      onClick={() => {
                        setResult(null);
                        setPage(
                          (value) => value - 1
                        );
                      }}
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
                      onClick={() => {
                        setResult(null);
                        setPage(
                          (value) => value + 1
                        );
                      }}
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

      {/* CONFIRMATION */}
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