import { useState } from "react";
import {
  ImagePlus,
  Paperclip,
  Send,
  Smile,
} from "lucide-react";

export default function MessageInput({
  onSend,
  onUnavailable,
}) {
  const [text, setText] = useState("");

  function submit(event) {
    event.preventDefault();

    const content = text.trim();

    if (!content) return;

    onSend(content);
    setText("");
  }

  function handleKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();

      if (!event.nativeEvent.isComposing) {
        event.currentTarget.form?.requestSubmit();
      }
    }
  }

  return (
    <form className="message-composer" onSubmit={submit}>
      <div className="composer-tools">
        <button
          type="button"
          title="Đính kèm file (chưa triển khai)"
          aria-label="Đính kèm file"
          onClick={() => onUnavailable("Đính kèm file")}
        >
          <Paperclip size={20} />
        </button>

        <button
          type="button"
          title="Gửi hình ảnh (chưa triển khai)"
          aria-label="Gửi hình ảnh"
          onClick={() => onUnavailable("Gửi hình ảnh")}
        >
          <ImagePlus size={21} />
        </button>
      </div>

      <div className="composer-input-wrap">
        <textarea
          rows={1}
          maxLength={4000}
          value={text}
          onChange={(event) =>
            setText(event.target.value)
          }
          onKeyDown={handleKeyDown}
          placeholder="Nhập tin nhắn demo..."
          aria-label="Nội dung tin nhắn"
        />

        <button
          type="button"
          className="composer-emoji"
          title="Emoji (chưa triển khai)"
          aria-label="Emoji"
          onClick={() => onUnavailable("Emoji")}
        >
          <Smile size={20} />
        </button>
      </div>

      <button
        type="submit"
        className="composer-send"
        disabled={!text.trim()}
        title="Thêm tin nhắn vào bản demo"
        aria-label="Gửi tin nhắn demo"
      >
        <Send size={19} />
      </button>
    </form>
  );
}