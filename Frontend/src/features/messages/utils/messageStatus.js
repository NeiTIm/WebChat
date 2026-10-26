// =====================================================
// 5.8E3 - MESSAGE STATUS
// Sent / Delivered / Seen
// =====================================================

// Hàm thuần, không gọi REST.
// Không thay đổi MessageDto hoặc database.

export function getMessageStatus(
  message,
  conversationStatus
) {
  if (!message || !conversationStatus) {
    return null;
  }

  const sequence = message.sequenceNumber;

  // Chỉ tin đã được backend xác nhận
  // mới được phép hiển thị trạng thái.
  if (
    !message.id ||
    !Number.isSafeInteger(sequence) ||
    sequence <= 0
  ) {
    return null;
  }

  const read =
    conversationStatus.otherLastReadSequence;

  const delivered =
    conversationStatus.otherLastDeliveredSequence;

  // Không tự giả định cursor còn thiếu bằng 0.
  if (
    !Number.isSafeInteger(read) ||
    read < 0 ||
    !Number.isSafeInteger(delivered) ||
    delivered < 0
  ) {
    return null;
  }

  // Ưu tiên Seen trước Delivered.
  if (read >= sequence) {
    return "seen";
  }

  if (delivered >= sequence) {
    return "delivered";
  }

  return "sent";
}