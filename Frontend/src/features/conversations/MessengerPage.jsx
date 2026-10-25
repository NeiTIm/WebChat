import { useState } from "react";
import { MessageCircle, MessagesSquare, X } from "lucide-react";

import { useAuth } from "../auth/hooks/useAuth";

import MessengerSidebar from "./components/MessengerSidebar";
import ConversationList from "./components/ConversationList";
import ChatHeader from "./components/ChatHeader";

import MessageList from "../messages/components/MessageList";
import MessageInput from "../messages/components/MessageInput";

import { mockConversations } from "./data/mockConversations";

import "../../styles/messenger.css";

function getCurrentTime() {
  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());
}

export default function MessengerPage() {
  const {
    user,
    logout,
    isLoggingOut,
  } = useAuth();

  const [conversations, setConversations] = useState(
    mockConversations
  );

  const [selectedId, setSelectedId] = useState(null);
  const [mobileChatOpen, setMobileChatOpen] =
    useState(false);

  const [notice, setNotice] = useState("");
  const [logoutError, setLogoutError] = useState("");

  const selectedConversation =
    conversations.find((item) => item.id === selectedId) ||
    null;

  function handleSelectConversation(id) {
    setSelectedId(id);
    setMobileChatOpen(true);
    setNotice("");

    setConversations((previous) =>
      previous.map((conversation) =>
        conversation.id === id
          ? { ...conversation, unreadCount: 0 }
          : conversation
      )
    );
  }

  function handleBack() {
    setMobileChatOpen(false);
  }

  function handleUnavailable(feature) {
    setNotice(`${feature} sẽ được triển khai ở bước tiếp theo.`);
  }

  function handleSendMessage(content) {
    if (!selectedId) return;

    const message = {
      id: crypto.randomUUID(),
      sender: "me",
      content,
      time: getCurrentTime(),
    };

    setConversations((previous) =>
      previous.map((conversation) => {
        if (conversation.id !== selectedId) {
          return conversation;
        }

        return {
          ...conversation,
          lastMessage: content,
          lastMessageTime: message.time,
          messages: [...conversation.messages, message],
        };
      })
    );
  }

  async function handleLogout() {
    setLogoutError("");

    try {
      await logout();
    } catch {
      setLogoutError(
        "Không thể đăng xuất trên máy chủ. Vui lòng thử lại."
      );
    }
  }

  return (
    <main className="messenger-app">
      <MessengerSidebar
        user={user}
        onLogout={handleLogout}
        isLoggingOut={isLoggingOut}
        onUnavailable={handleUnavailable}
      />

      <div
        className={`messenger-conversation-column ${
          mobileChatOpen ? "mobile-hidden" : ""
        }`}
      >
        <ConversationList
          conversations={conversations}
          selectedId={selectedId}
          onSelect={handleSelectConversation}
          onCreateConversation={() =>
            handleUnavailable("Tạo cuộc trò chuyện")
          }
        />
      </div>

      <section
        className={`messenger-chat-column ${
          mobileChatOpen ? "mobile-open" : ""
        }`}
      >
        {selectedConversation ? (
          <>
            <ChatHeader
              conversation={selectedConversation}
              onBack={handleBack}
              onUnavailable={handleUnavailable}
            />

            <MessageList
              key={selectedConversation.id}
              conversation={selectedConversation}
              messages={selectedConversation.messages}
            />

            <MessageInput
              key={`input-${selectedConversation.id}`}
              onSend={handleSendMessage}
              onUnavailable={handleUnavailable}
            />
          </>
        ) : (
          <div className="messenger-empty-state">
            <div className="empty-state-icon">
              <MessagesSquare size={42} />
            </div>

            <h2>Chào mừng đến WebChat</h2>

            <p>
              Xin chào, {user?.displayName || user?.username}!
              <br />
              Chọn một cuộc trò chuyện để bắt đầu.
            </p>

            <span>
              <MessageCircle size={15} />
              Giao diện đang sử dụng dữ liệu mẫu
            </span>
          </div>
        )}
      </section>

      {(notice || logoutError) && (
        <div className="messenger-toast" role="status">
          <span>{logoutError || notice}</span>

          <button
            type="button"
            onClick={() => {
              setNotice("");
              setLogoutError("");
            }}
            aria-label="Đóng thông báo"
          >
            <X size={17} />
          </button>
        </div>
      )}
    </main>
  );
}