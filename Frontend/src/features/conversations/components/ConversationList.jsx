import { Search, MessageSquarePlus } from "lucide-react";
import { useMemo, useState } from "react";
import ConversationItem from "./ConversationItem";

export default function ConversationList({
  conversations,
  selectedId,
  onSelect,
  onCreateConversation,
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");

  const filtered = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase();

    return conversations.filter((conversation) => {
      const matchesSearch = conversation.name
        .toLocaleLowerCase()
        .includes(keyword);

      const matchesFilter =
        filter === "all" ||
        (filter === "unread" &&
          conversation.unreadCount > 0) ||
        (filter === "groups" &&
          conversation.type === "group");

      return matchesSearch && matchesFilter;
    });
  }, [conversations, filter, search]);

  return (
    <section className="conversation-panel">
      <div className="conversation-panel-header">
        <div className="conversation-title-row">
          <h1>Đoạn chat</h1>

          <button
            type="button"
            className="round-action"
            onClick={onCreateConversation}
            aria-label="Tạo cuộc trò chuyện mới"
            title="Tạo cuộc trò chuyện mới"
          >
            <MessageSquarePlus size={20} />
          </button>
        </div>

        <label className="conversation-search">
          <Search size={18} />
          <input
            type="search"
            placeholder="Tìm kiếm cuộc trò chuyện"
            aria-label="Tìm kiếm cuộc trò chuyện"
            value={search}
            onChange={(event) =>
              setSearch(event.target.value)
            }
          />
        </label>

        <div className="conversation-filters">
          {[
            { value: "all", label: "Tất cả" },
            { value: "unread", label: "Chưa đọc" },
            { value: "groups", label: "Nhóm" },
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
              aria-pressed={filter === item.value}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="conversation-scroll">
        {filtered.length === 0 ? (
          <div className="conversation-empty">
            Không tìm thấy cuộc trò chuyện.
          </div>
        ) : (
          filtered.map((conversation) => (
            <ConversationItem
              key={conversation.id}
              conversation={conversation}
              selected={
                selectedId === conversation.id
              }
              onSelect={onSelect}
            />
          ))
        )}
      </div>

      <div className="mock-data-caption">
        Dữ liệu hội thoại mẫu
      </div>
    </section>
  );
}