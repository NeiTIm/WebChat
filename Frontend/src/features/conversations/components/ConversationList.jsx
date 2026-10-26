
import { Search, MessageSquarePlus } from "lucide-react";
import { useMemo, useState } from "react";

import ConversationItem from "./ConversationItem";

export default function ConversationList({
  conversations = [],
  selectedId,
  onSelect,
  onCreateConversation,

  loading = false,
  loadingMore = false,
  error = "",
  hasMore = false,

  onRefresh,
  onLoadMore,
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");

  // =====================================================
  // FILTER LOADED CONVERSATIONS
  // =====================================================

  const filtered = useMemo(() => {
    const keyword = search
      .trim()
      .toLocaleLowerCase("vi-VN");

    return conversations.filter((conversation) => {
      const name = String(
        conversation.name || ""
      ).toLocaleLowerCase("vi-VN");

      const matchesSearch =
        name.includes(keyword);

      const matchesFilter =
        filter === "all" ||
        (filter === "unread" &&
          conversation.unreadCount > 0) ||
        (filter === "groups" &&
          conversation.type === "group");

      return matchesSearch && matchesFilter;
    });
  }, [conversations, filter, search]);

  // =====================================================
  // RENDER
  // =====================================================

  return (
    <section className="conversation-panel">

      {/* HEADER */}
      <div className="conversation-panel-header">
        <div className="conversation-title-row">
          <h1>Đoạn chat</h1>

          <button
            type="button"
            className="round-action"
            onClick={onCreateConversation}
            aria-label="Tìm bạn để nhắn tin"
            title="Tìm bạn để nhắn tin"
          >
            <MessageSquarePlus size={20} />
          </button>
        </div>

        {/* SEARCH */}
        <label className="conversation-search">
          <Search size={18} />

          <input
            type="search"
            placeholder="Tìm trong hội thoại đã tải"
            aria-label="Tìm kiếm cuộc trò chuyện"
            value={search}
            onChange={(event) =>
              setSearch(event.target.value)
            }
          />
        </label>

        {/* FILTERS */}
        <div className="conversation-filters">
          {[
            {
              value: "all",
              label: "Tất cả",
              disabled: false,
            },
            {
              value: "unread",
              label: "Chưa đọc",
              disabled: true,
            },
            {
              value: "groups",
              label: "Nhóm",
              disabled: true,
            },
          ].map((item) => (
            <button
              type="button"
              key={item.value}
              className={`filter-pill ${
                filter === item.value
                  ? "is-active"
                  : ""
              }`}
              onClick={() => setFilter(item.value)}
              disabled={item.disabled}
              aria-pressed={filter === item.value}
              title={
                item.disabled
                  ? "Chức năng chưa được triển khai"
                  : undefined
              }
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* ERROR */}
      {error && (
        <div
          role="alert"
          style={{
            padding: "12px 16px",
            color: "#dc2626",
            fontSize: "13px",
          }}
        >
          <p style={{ margin: "0 0 8px" }}>
            {error}
          </p>

          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
          >
            Thử lại
          </button>
        </div>
      )}

      {/* CONVERSATIONS */}
      <div className="conversation-scroll">
        {loading ? (
          <div
            className="conversation-empty"
            role="status"
          >
            Đang tải hội thoại...
          </div>
        ) : filtered.length === 0 ? (
          <div className="conversation-empty">
            {search.trim()
              ? "Không tìm thấy hội thoại trong danh sách đã tải."
              : conversations.length === 0
                ? error
                  ? "Không thể tải danh sách hội thoại."
                  : "Chưa có cuộc trò chuyện nào."
                : "Không có hội thoại phù hợp."}
          </div>
        ) : (
          filtered.map((conversation) => (
            <ConversationItem
              key={conversation.id}
              conversation={conversation}
              selected={
                String(selectedId || "").toLowerCase() ===
                String(conversation.id).toLowerCase()
              }
              onSelect={onSelect}
            />
          ))
        )}
      </div>

      {/* FOOTER */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          padding: "10px 14px",
          borderTop: "1px solid rgba(128,128,128,0.12)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <span
            style={{
              fontSize: "12px",
              opacity: 0.7,
            }}
          >
            {conversations.length} hội thoại đã tải
          </span>

          <button
            type="button"
            onClick={onRefresh}
            disabled={loading || loadingMore}
            style={{
              cursor: "pointer",
              border: 0,
              background: "transparent",
              color: "inherit",
              fontSize: "12px",
            }}
          >
            Làm mới
          </button>
        </div>

        {!loading && hasMore && (
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loadingMore}
            style={{
              border: "1px solid rgba(128,128,128,0.2)",
              borderRadius: "9px",
              padding: "9px",
              cursor: loadingMore ? "wait" : "pointer",
              background: "transparent",
              color: "inherit",
            }}
          >
            {loadingMore
              ? "Đang tải thêm..."
              : "Tải thêm hội thoại"}
          </button>
        )}
      </div>
    </section>
  );
}
