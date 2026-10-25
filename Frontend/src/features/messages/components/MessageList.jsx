import { useEffect, useRef } from "react";

export default function MessageList({
  messages,
  conversation,
}) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [messages]);

  return (
    <div
      className="message-list"
      role="log"
      aria-label={`Tin nhắn trong ${conversation?.name || "cuộc trò chuyện"}`}
      aria-live="polite"
    >
      <div className="chat-introduction">
        <div
          className="chat-intro-avatar"
          style={{
            backgroundColor: conversation.avatarColor,
            color: conversation.avatarTextColor,
          }}
        >
          {conversation.initials}
        </div>

        <h3>{conversation.name}</h3>

        <p>
          {conversation.type === "group"
            ? "Đây là giao diện nhóm chat mẫu."
            : "Đây là giao diện cuộc trò chuyện mẫu."}
        </p>
      </div>

      <div className="message-date-divider">
        <span>Hôm nay · Demo</span>
      </div>

      {messages.map((message) => {
        const isMine = message.sender === "me";

        return (
          <div
            key={message.id}
            className={`message-row ${
              isMine ? "message-mine" : "message-other"
            }`}
          >
            <div className="message-content-wrapper">
              {!isMine && message.senderName && (
                <span className="message-sender-name">
                  {message.senderName}
                </span>
              )}

              <div className="message-bubble">
                {message.content}
              </div>

              <span className="message-timestamp">
                {message.time}
              </span>
            </div>
          </div>
        );
      })}

      <div ref={bottomRef} />
    </div>
  );
}