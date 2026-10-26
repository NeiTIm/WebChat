import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Ban,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Search,
  SearchX,
  ShieldAlert,
  UserRound,
  UserRoundCheck,
  UserRoundPlus,
  Users,
  X,
} from "lucide-react";

import { userApi } from "../api/userApi";
import { getAuthError } from "../../auth/api/authApi";
import {
  friendApi,
  getFriendError,
} from "../../friends/api/friendApi";

import "../../../styles/user-search.css";

// =====================================================
// AVATAR
// =====================================================

function SearchAvatar({ user }) {
  const [failedUrl, setFailedUrl] = useState(null);

  const name = (
    user.displayName ||
    user.username ||
    "U"
  ).trim();

  const initials = name
    .split(/\s+/)
    .slice(-2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");

  return (
    <div className="user-search-avatar">
      {user.avatarUrl &&
      failedUrl !== user.avatarUrl ? (
        <img
          src={user.avatarUrl}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(user.avatarUrl)}
        />
      ) : (
        initials || <UserRound size={22} />
      )}
    </div>
  );
}

// =====================================================
// FRIEND STATUS BUTTON
// =====================================================

function RelationshipAction({
  user,
  relationship,
  sendingId,
  onSend,
}) {
  const status = relationship?.status;
  const busy = sendingId !== null;

  // Nếu Backend không cung cấp trạng thái hợp lệ,
  // không cho gửi lời mời để tránh thao tác sai.
  if (!status) {
    return (
      <span className="user-search-relation neutral">
        Chưa xác định
      </span>
    );
  }

  switch (status) {
    case "Friend":
      return (
        <span className="user-search-relation friend">
          <UserRoundCheck size={16} />
          Bạn bè
        </span>
      );

    case "PendingSent":
      return (
        <Link
          className="user-search-relation pending"
          to="/friends?tab=sent"
        >
          <Clock3 size={16} />
          Đã gửi lời mời
        </Link>
      );

    case "PendingReceived":
      return (
        <Link
          className="user-search-relation received"
          to="/friends?tab=received"
        >
          <UserRoundPlus size={16} />
          Xem lời mời
        </Link>
      );

    case "Blocked":
      return (
        <Link
          className="user-search-relation blocked"
          to="/friends?tab=blocked"
        >
          <Ban size={16} />
          Đã chặn
        </Link>
      );

    case "Unavailable":
      return (
        <span
          className="user-search-relation neutral"
          title="Hiện không thể gửi lời mời đến tài khoản này."
        >
          <ShieldAlert size={16} />
          Không thể kết bạn
        </span>
      );

    case "None":
      return (
        <button
          type="button"
          className="user-search-send-button"
          disabled={busy}
          onClick={() => onSend(user)}
        >
          <UserRoundPlus size={16} />
          {sendingId === user.id
            ? "Đang gửi..."
            : "Kết bạn"}
        </button>
      );

    default:
      return (
        <span className="user-search-relation neutral">
          Chưa xác định
        </span>
      );
  }
}

// =====================================================
// USER SEARCH PAGE
// =====================================================

export default function UserSearchPage() {
  // Search
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // API result
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  // Friend Request
  const [sendingId, setSendingId] = useState(null);
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState("");

  // =====================================================
  // DEBOUNCE 300 MS
  // =====================================================

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 300);

    return () => {
      window.clearTimeout(timer);
    };
  }, [query]);

  // =====================================================
  // LOAD USERS + RELATIONSHIPS
  // =====================================================

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function loadUsers() {
      try {
        // 1. Lấy danh sách người dùng.
        const data = await userApi.searchUsers({
          query: debouncedQuery,
          page,
          pageSize,
          signal: controller.signal,
        });

        if (!active || controller.signal.aborted) {
          return;
        }

        if (
          !data ||
          !Array.isArray(data.items) ||
          typeof data.total !== "number"
        ) {
          throw new Error(
            "Dữ liệu người dùng từ Backend không hợp lệ."
          );
        }

        // 2. Lấy trạng thái quan hệ đúng theo
        // danh sách user vừa truy vấn.
        const ids = data.items.map((user) => user.id);

        let statusItems = [];

        if (ids.length > 0) {
          const statusResponse =
            await friendApi.getStatuses(
              ids,
              controller.signal
            );

          if (
            !statusResponse ||
            !Array.isArray(statusResponse.items)
          ) {
            throw new Error(
              "Dữ liệu quan hệ bạn bè không hợp lệ."
            );
          }

          statusItems = statusResponse.items;
        }

        if (!active || controller.signal.aborted) {
          return;
        }

        const statuses = Object.fromEntries(
          statusItems.map((item) => [
            item.userId,
            {
              status: item.status,
              requestId: item.requestId,
            },
          ])
        );

        setResult({
          ...data,
          searchQuery: debouncedQuery,
          statuses,
        });

        setError("");
      } catch (err) {
        if (!active || controller.signal.aborted) {
          return;
        }

        setResult(null);

        if (
          err.message ===
            "Dữ liệu người dùng từ Backend không hợp lệ." ||
          err.message ===
            "Dữ liệu quan hệ bạn bè không hợp lệ."
        ) {
          setError(err.message);
        } else {
          setError(getAuthError(err));
        }
      } finally {
        if (active && !controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    Promise.resolve().then(() => {
      if (!active || controller.signal.aborted) {
        return;
      }

      setLoading(true);
      setError("");
      setResult(null);

      loadUsers();
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, [debouncedQuery, page, pageSize, refreshKey]);

  // =====================================================
  // EVENTS
  // =====================================================

  function handleQueryChange(event) {
    setQuery(event.target.value);
    setPage(1);
    setResult(null);
    setError("");
    setActionMessage("");
    setActionError("");
  }

  function clearSearch() {
    setQuery("");
    setPage(1);
    setResult(null);
    setError("");
  }

  function handlePageSizeChange(event) {
    setPageSize(Number(event.target.value));
    setPage(1);
    setResult(null);
    setError("");
  }

  function refreshUsers() {
    setResult(null);
    setError("");
    setRefreshKey((value) => value + 1);
  }

  // =====================================================
  // SEND FRIEND REQUEST
  // =====================================================

  async function sendFriendRequest(user) {
    if (sendingId !== null) return;

    // Kiểm tra thêm ở Frontend.
    // Backend vẫn là nơi thực thi quyền cuối cùng.
    if (result?.statuses?.[user.id]?.status !== "None") {
      return;
    }

    setSendingId(user.id);
    setActionMessage("");
    setActionError("");

    try {
      await friendApi.sendRequest(user.id);

      setActionMessage(
        `Đã gửi lời mời kết bạn đến ${
          user.displayName || user.username
        }.`
      );

      // Không dùng sentIds tạm.
      // Tải lại trạng thái thật từ SQL.
      refreshUsers();
    } catch (err) {
      setActionError(getFriendError(err));

      // Quan hệ có thể vừa thay đổi trên thiết bị khác.
      // Đọc lại trạng thái để UI được đồng bộ.
      refreshUsers();
    } finally {
      setSendingId(null);
    }
  }

  // =====================================================
  // DISPLAY
  // =====================================================

  const keyword = query.trim();
  const isTyping = keyword !== debouncedQuery;
  const isSearching = keyword.length > 0;

  const ready =
    !isTyping &&
    !loading &&
    !error &&
    result !== null &&
    Array.isArray(result.items) &&
    result.searchQuery === debouncedQuery &&
    result.page === page &&
    result.pageSize === pageSize;

  const items = ready ? result.items : [];

  const showLoading =
    isTyping ||
    loading ||
    (!error && !ready);

  // =====================================================
  // JSX
  // =====================================================

  return (
    <main className="user-search-page">
      <div className="user-search-container">
        <header className="user-search-topbar">
          <Link
            to="/messenger"
            className="user-search-back"
          >
            <ArrowLeft size={18} />
            Messenger
          </Link>

          <span className="user-search-brand">
            <span>W</span>
            WebChat
          </span>
        </header>

        <section className="user-search-heading">
          <div className="user-search-heading-icon">
            <Users size={25} />
          </div>

          <div>
            <h1>Khám phá bạn bè</h1>
            <p>
              Khám phá và kết nối với mọi người
              trên WebChat.
            </p>
          </div>

          <Link
            to="/friends"
            className="user-search-friends-link"
          >
            <Users size={17} />
            Bạn bè
          </Link>
        </section>

        <section className="user-search-card">
          <div className="user-search-controls">
            <div className="user-search-field">
              <Search size={21} />

              <input
                type="search"
                value={query}
                onChange={handleQueryChange}
                maxLength={80}
                placeholder="Tìm theo tên hoặc username..."
                aria-label="Tìm kiếm người dùng"
                autoComplete="off"
              />

              {query.length > 0 && (
                <button
                  type="button"
                  onClick={clearSearch}
                  aria-label="Xóa từ khóa"
                  title="Xóa từ khóa"
                  className="user-search-clear"
                >
                  <X size={17} />
                </button>
              )}
            </div>

            <label className="user-search-page-size">
              <span>Hiển thị</span>

              <select
                value={pageSize}
                onChange={handlePageSizeChange}
                aria-label="Số người trên một trang"
              >
                <option value={20}>20</option>
                <option value={50}>50</option>
              </select>
            </label>
          </div>

          {actionMessage && (
            <div
              className="user-search-action-alert success"
              role="status"
            >
              <Check size={17} />
              {actionMessage}
            </div>
          )}

          {actionError && (
            <div
              className="user-search-action-alert error"
              role="alert"
            >
              {actionError}
            </div>
          )}

          <div className="user-search-result-header">
            <h2>
              {isSearching
                ? "Kết quả tìm kiếm"
                : "Khám phá người dùng"}
            </h2>

            {ready && (
              <span>{result.total} người dùng</span>
            )}
          </div>

          {showLoading ? (
            <div
              className="user-search-empty"
              role="status"
            >
              <div className="loading-spinner" />
              <p>
                {isSearching
                  ? "Đang tìm kiếm và kiểm tra kết bạn..."
                  : "Đang tải người dùng..."}
              </p>
            </div>
          ) : error ? (
            <div
              className="user-search-empty"
              role="alert"
            >
              <SearchX size={35} />
              <h3>Không thể tải dữ liệu</h3>
              <p>{error}</p>

              <button
                type="button"
                onClick={refreshUsers}
              >
                Thử lại
              </button>
            </div>
          ) : ready && items.length === 0 ? (
            <div className="user-search-empty">
              <SearchX size={35} />

              <h3>
                {isSearching
                  ? "Không tìm thấy người dùng"
                  : "Chưa có người dùng để khám phá"}
              </h3>

              <p>
                {isSearching
                  ? "Hãy thử từ khóa khác."
                  : "Hiện chưa có tài khoản khác đang hoạt động."}
              </p>

              {isSearching && (
                <button
                  type="button"
                  onClick={clearSearch}
                >
                  Xem tất cả
                </button>
              )}
            </div>
          ) : (
            <div className="user-search-results">
              {items.map((user) => (
                <article
                  key={user.id}
                  className="user-search-item"
                >
                  <SearchAvatar user={user} />

                  <div className="user-search-item-info">
                    <h3>
                      {user.displayName || user.username}
                    </h3>

                    <p className="user-search-username">
                      @{user.username}
                    </p>

                    {user.bio && (
                      <p className="user-search-bio">
                        {user.bio}
                      </p>
                    )}
                  </div>

                  <RelationshipAction
                    user={user}
                    relationship={result.statuses[user.id]}
                    sendingId={sendingId}
                    onSend={sendFriendRequest}
                  />
                </article>
              ))}
            </div>
          )}

          {ready && result.totalPages > 1 && (
            <div className="user-search-pagination">
              <button
                type="button"
                disabled={
                  !result.hasPreviousPage ||
                  sendingId !== null
                }
                onClick={() => {
                  setResult(null);
                  setPage((value) => value - 1);
                }}
              >
                <ChevronLeft size={17} />
                Trước
              </button>

              <span>
                Trang {result.page} / {result.totalPages}
              </span>

              <button
                type="button"
                disabled={
                  !result.hasNextPage ||
                  sendingId !== null
                }
                onClick={() => {
                  setResult(null);
                  setPage((value) => value + 1);
                }}
              >
                Sau
                <ChevronRight size={17} />
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}