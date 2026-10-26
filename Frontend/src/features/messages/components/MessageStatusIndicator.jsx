import {
  Check,
  CheckCheck,
} from "lucide-react";

import "../../../styles/message-status.css";

// =====================================================
// 5.8E3 - STATUS PRESENTATION
// =====================================================

const STATUSES = {
  sent: {
    label: "Đã gửi",
    Icon: Check,
  },

  delivered: {
    label: "Đã nhận",
    Icon: CheckCheck,
  },

  seen: {
    label: "Đã xem",
    Icon: CheckCheck,
  },
};

export default function MessageStatusIndicator({
  status,
}) {
  const definition = STATUSES[status];

  if (!definition) {
    return null;
  }

  const {
    label,
    Icon,
  } = definition;

  return (
    <span
      className={
        `webchat-message-status ` +
        `webchat-message-status--${status}`
      }
      role="status"
      aria-label={`Trạng thái tin nhắn: ${label}`}
      title={label}
    >
      <Icon
        size={13}
        strokeWidth={2.2}
        aria-hidden="true"
      />

      <span>{label}</span>
    </span>
  );
}