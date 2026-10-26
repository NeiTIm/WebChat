
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

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

import { useChatRealtime } from
  "../../realtime/hooks/useChatRealtime";

import "../../../styles/user-search.css";

const REALTIME_REFRESH_DELAY = 150;

// =====================================================
// HELPERS
// =====================================================

function normalizeId(value) {
  return String(value ?? "").trim().toLowerCase();
}

function getUserName(user) {
  return (
    user?.displayName ||
    user?.username ||
    "Người dùng"
  );
}

// =====================================================
// AVATAR
// =====================================================

function SearchAvatar({ user }) {
  const [failedUrl, setFailedUrl] =
    useState(null);

  const initials = getUserName(user)
    .trim()
    .split(/\s+/)
    .slice(-2)
    .map((part) =>
      part.charAt(0).toUpperCase()
    )
    .join("");

  return (
    <div className="user-search-avatar">
      {user.avatarUrl &&
      failedUrl !== user.avatarUrl ? (
        <img
          src={user.avatarUrl}
          alt=""
          referrerPolicy="no-referrer"
          onError={() =>
            setFailedUrl(user.avatarUrl)
          }
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
  const {
    subscribe,
    syncVersion,
  } = useChatRealtime();

  // =====================================================
  // SEARCH
  // =====================================================

  const [query, setQuery] = useState("");

  const [
    debouncedQuery,
    setDebouncedQuery,
  ] = useState("");

  // =====================================================
  // PAGINATION
  // =====================================================

  const [page, setPage] = useState(1);

  const [pageSize, setPageSize] =
    useState(20);

  // =====================================================
  // API RESULT
  // =====================================================

  const [result, setResult] =
    useState(null);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  const [
    realtimeSyncError,
    setRealtimeSyncError,
  ] = useState("");

  const [refreshKey, setRefreshKey] =
    useState(0);

  // =====================================================
  // FRIEND REQUEST
  // =====================================================

  const [sendingId, setSendingId] =
    useState(null);

  const [
    actionMessage,
    setActionMessage,
  ] = useState("");

  const [
    actionError,
    setActionError,
  ] = useState("");

  // =====================================================
  // REFS
  // =====================================================

  const realtimeTimerRef = useRef(null);

  const previousSyncVersionRef =
    useRef(syncVersion);

  // Chỉ ghi snapshot sau khi REST trả kết quả hợp lệ.
  // Cho phép giữ danh sách hiện tại khi refresh nền.
  const latestResultRef = useRef(null);

  // =====================================================
  // DEBOUNCE SEARCH - 300 MS
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
  // 5.7.8C - DEBOUNCED REALTIME REFRESH
  // =====================================================

  const scheduleRealtimeRefresh =
    useCallback(() => {
      if (realtimeTimerRef.current !== null) {
        window.clearTimeout(
          realtimeTimerRef.current
        );
      }

      realtimeTimerRef.current =
        window.setTimeout(() => {
          realtimeTimerRef.current = null;

          setRefreshKey(
            (value) => value + 1
          );
        }, REALTIME_REFRESH_DELAY);
    }, []);

  // =====================================================
  // SIGNALR FRIEND EVENTS
  // =====================================================

  useEffect(() => {
    const unsubscribeRequest = subscribe(
      "FriendRequestChanged",
      scheduleRealtimeRefresh
    );

    const unsubscribeFriendship = subscribe(
      "FriendshipChanged",
      scheduleRealtimeRefresh
    );

    return () => {
      unsubscribeRequest();
      unsubscribeFriendship();

      if (realtimeTimerRef.current !== null) {
        window.clearTimeout(
          realtimeTimerRef.current
        );

        realtimeTimerRef.current = null;
      }
    };
  }, [
    subscribe,
    scheduleRealtimeRefresh,
  ]);

  // =====================================================
  // SIGNALR RECONNECT / SYNC REQUIRED
  // =====================================================

  useEffect(() => {
    if (
      previousSyncVersionRef.current ===
      syncVersion
    ) {
      return;
    }

    previousSyncVersionRef.current =
      syncVersion;

    scheduleRealtimeRefresh();
  }, [
    syncVersion,
    scheduleRealtimeRefresh,
  ]);

  // =====================================================
  // LOAD USERS + RELATIONSHIPS
  // =====================================================

  useEffect(() => {
    const controller =
      new AbortController();

    let active = true;

    const previous =
      latestResultRef.current;

    const canKeepExistingList =
      previous !== null &&
      Array.isArray(previous.items) &&
      previous.searchQuery === debouncedQuery &&
      previous.page === page &&
      previous.pageSize === pageSize;

    async function loadUsers() {
      try {
        // =============================================
        // 1. USER DISCOVERY
        // =============================================

        const data =
          await userApi.searchUsers({
            query: debouncedQuery,
            page,
            pageSize,
            signal: controller.signal,
          });

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
            "Dữ liệu người dùng từ Backend không hợp lệ."
          );
        }

        // =============================================
        // 2. BATCH FRIENDSHIP STATUS
        // =============================================

        const ids = data.items.map(
          (item) => item.id
        );

        let statusItems = [];

        if (ids.length > 0) {
          const statusResponse =
            await friendApi.getStatuses(
              ids,
              controller.signal
            );

          if (
            !statusResponse ||
            !Array.isArray(
              statusResponse.items
            )
          ) {
            throw new Error(
              "Dữ liệu quan hệ bạn bè không hợp lệ."
            );
          }

          statusItems =
            statusResponse.items;
        }

        if (
          !active ||
          controller.signal.aborted
        ) {
          return;
        }

        const statuses =
          Object.fromEntries(
            statusItems.map((item) => [
              normalizeId(item.userId),
              {
                status: item.status,
                requestId: item.requestId,
              },
            ])
          );

        const nextResult = {
          ...data,
          searchQuery: debouncedQuery,
          statuses,
        };

        // =============================================
        // 3. UPDATE VALID RESULT
        // =============================================

        latestResultRef.current =
          nextResult;

        setResult(nextResult);

        setError("");
        setRealtimeSyncError("");
      } catch (err) {
        if (
          !active ||
          controller.signal.aborted
        ) {
          return;
        }

        const message =
          err?.message ===
            "Dữ liệu người dùng từ Backend không hợp lệ." ||
          err?.message ===
            "Dữ liệu quan hệ bạn bè không hợp lệ."
            ? err.message
            : getAuthError(err);

        // Refresh nền bị lỗi:
        // Giữ nguyên dữ liệu cũ để không nhấp nháy.
        if (canKeepExistingList) {
          setRealtimeSyncError(
            "Chưa thể cập nhật trạng thái kết bạn. " +
            "Bạn có thể thử làm mới."
          );
        } else {
          setResult(null);
          setError(message);
        }
      } finally {
        if (
          active &&
          !controller.signal.aborted
        ) {
          setLoading(false);
        }
      }
    }

    Promise.resolve().then(() => {
      if (
        !active ||
        controller.signal.aborted
      ) {
        return;
      }

      if (!canKeepExistingList) {
        setLoading(true);
        setResult(null);
      }

      setError("");

      void loadUsers();
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, [
    debouncedQuery,
    page,
    pageSize,
    refreshKey,
  ]);

  // =====================================================
  // EVENTS - SEARCH
  // =====================================================

  function handleQueryChange(event) {
    setQuery(event.target.value);
    setPage(1);
    setResult(null);

    setError("");
    setRealtimeSyncError("");

    setActionMessage("");
    setActionError("");
  }

  function clearSearch() {
    setQuery("");
    setPage(1);
    setResult(null);

    setError("");
    setRealtimeSyncError("");
  }

  function handlePageSizeChange(event) {
    setPageSize(
      Number(event.target.value)
    );

    setPage(1);
    setResult(null);

    setError("");
    setRealtimeSyncError("");
  }

  // =====================================================
  // MANUAL REFRESH
  // =====================================================

  function refreshUsers() {
    setError("");
    setRealtimeSyncError("");

    setRefreshKey(
      (value) => value + 1
    );
  }

  // =====================================================
  // SEND FRIEND REQUEST
  // =====================================================

  async function sendFriendRequest(user) {
    if (sendingId !== null) {
      return;
    }

    // Kiểm tra trạng thái tại Frontend.
    // Backend vẫn là nguồn xác thực cuối cùng.
    const userId = normalizeId(user.id);

    if (
      result?.statuses?.[userId]?.status !==
      "None"
    ) {
      return;
    }

    setSendingId(user.id);

    setActionMessage("");
    setActionError("");

    try {
      await friendApi.sendRequest(user.id);

      setActionMessage(
        `Đã gửi lời mời kết bạn đến ${getUserName(user)}.`
      );

      // Tải trạng thái thực từ Backend.
      refreshUsers();
    } catch (err) {
      setActionError(
        getFriendError(err)
      );

      // Quan hệ có thể thay đổi ở thiết bị khác.
      refreshUsers();
    } finally {
      setSendingId(null);
    }
  }

  // =====================================================
  // DISPLAY STATE
  // =====================================================

  const keyword = query.trim();

  const isTyping =
    keyword !== debouncedQuery;

  const isSearching =
    keyword.length > 0;

  const ready =
    !isTyping &&
    !loading &&
    !error &&
    result !== null &&
    Array.isArray(result.items) &&
    result.searchQuery === debouncedQuery &&
    result.page === page &&
    result.pageSize === pageSize;

  const items =
    ready ? result.items : [];

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

        {/* =========================================
            TOPBAR
            ========================================= */}

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

        {/* =========================================
            HEADING
            ========================================= */}

        <section className="user-search-heading">
          <div className="user-search-heading-icon">
            <Users size={25} />
          </div>

          <div>
            <h1>
              Khám phá bạn bè
            </h1>

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

        {/* =========================================
            MAIN CARD
            ========================================= */}

        <section className="user-search-card">

          {/* SEARCH CONTROLS */}

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
                <option value={20}>
                  20
                </option>

                <option value={50}>
                  50
                </option>
              </select>
            </label>
          </div>

          {/* =========================================
              ACTION SUCCESS
              ========================================= */}

          {actionMessage && (
            <div
              className="user-search-action-alert success"
              role="status"
            >
              <Check size={17} />
              {actionMessage}
            </div>
          )}

          {/* =========================================
              ACTION ERROR
              ========================================= */}

          {actionError && (
            <div
              className="user-search-action-alert error"
              role="alert"
            >
              {actionError}
            </div>
          )}

          {/* =========================================
              BACKGROUND SYNC WARNING
              ========================================= */}

          {realtimeSyncError && (
            <div
              className="user-search-action-alert error"
              role="status"
            >
              <span>
                {realtimeSyncError}
              </span>

              <button
                type="button"
                onClick={refreshUsers}
                style={{
                  marginLeft: "auto",
                  cursor: "pointer",
                }}
              >
                Thử lại
              </button>
            </div>
          )}

          {/* =========================================
              RESULT HEADER
              ========================================= */}

          <div className="user-search-result-header">
            <h2>
              {isSearching
                ? "Kết quả tìm kiếm"
                : "Khám phá người dùng"}
            </h2>

            {ready && (
              <span>
                {result.total} người dùng
              </span>
            )}
          </div>

          {/* =========================================
              LOADING
              ========================================= */}

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

              <h3>
                Không thể tải dữ liệu
              </h3>

              <p>{error}</p>

              <button
                type="button"
                onClick={refreshUsers}
              >
                Thử lại
              </button>
            </div>
          ) : ready &&
            items.length === 0 ? (
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
                      {getUserName(user)}
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
                    relationship={
                      result.statuses[
                        normalizeId(user.id)
                      ]
                    }
                    sendingId={sendingId}
                    onSend={sendFriendRequest}
                  />
                </article>
              ))}
            </div>
          )}

          {/* =========================================
              PAGINATION
              ========================================= */}

          {ready &&
            result.totalPages > 1 && (
              <div className="user-search-pagination">
                <button
                  type="button"
                  disabled={
                    !result.hasPreviousPage ||
                    sendingId !== null
                  }
                  onClick={() => {
                    setResult(null);

                    setPage(
                      (value) => value - 1
                    );
                  }}
                >
                  <ChevronLeft size={17} />
                  Trước
                </button>

                <span>
                  Trang {result.page} /{" "}
                  {result.totalPages}
                </span>

                <button
                  type="button"
                  disabled={
                    !result.hasNextPage ||
                    sendingId !== null
                  }
                  onClick={() => {
                    setResult(null);

                    setPage(
                      (value) => value + 1
                    );
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
