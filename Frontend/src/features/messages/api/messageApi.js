
import axiosClient from "../../../api/axiosClient";

// =====================================================
// CONFIG
// =====================================================

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const MAX_CONTENT_LENGTH = 4000;

function validateGuid(value, fieldName) {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ||
    value === "00000000-0000-0000-0000-000000000000"
  ) {
    throw new Error(`${fieldName} không hợp lệ.`);
  }
}

// =====================================================
// GET MESSAGE HISTORY
// GET /api/conversations/{id}/messages
// =====================================================

export async function getConversationMessages(
  conversationId,
  {
    beforeSequence = null,
    pageSize = DEFAULT_PAGE_SIZE,
    signal,
  } = {}
) {
  validateGuid(conversationId, "ConversationId");

  if (
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > MAX_PAGE_SIZE
  ) {
    throw new Error(
      "PageSize phải nằm trong khoảng 1 đến 50."
    );
  }

  if (
    beforeSequence !== null &&
    (
      !Number.isSafeInteger(beforeSequence) ||
      beforeSequence <= 0
    )
  ) {
    throw new Error(
      "beforeSequence phải là số nguyên dương an toàn."
    );
  }

  const params = { pageSize };

  if (beforeSequence !== null) {
    params.beforeSequence = beforeSequence;
  }

  const response = await axiosClient.get(
    `/api/conversations/${conversationId}/messages`,
    {
      params,
      signal,
    }
  );

  return response.data;
}

// =====================================================
// SEND TEXT MESSAGE
// POST /api/conversations/{id}/messages
// =====================================================

export async function sendTextMessage(
  conversationId,
  content,
  {
    clientMessageId,
    signal,
  } = {}
) {
  validateGuid(conversationId, "ConversationId");

  if (typeof content !== "string") {
    throw new Error(
      "Nội dung tin nhắn không hợp lệ."
    );
  }

  const normalizedContent = content.trim();

  if (!normalizedContent) {
    throw new Error(
      "Nội dung tin nhắn không được để trống."
    );
  }

  if (normalizedContent.length > MAX_CONTENT_LENGTH) {
    throw new Error(
      "Tin nhắn không được vượt quá 4000 ký tự."
    );
  }

  // Bắt buộc caller truyền GUID ổn định.
  // Nếu request cần retry, dùng lại chính GUID này.
  validateGuid(clientMessageId, "ClientMessageId");

  const response = await axiosClient.post(
    `/api/conversations/${conversationId}/messages`,
    {
      clientMessageId,
      content: normalizedContent,
    },
    { signal }
  );

  return response.data;
}

// =====================================================
// GENERATE CLIENT MESSAGE ID
// =====================================================

export function createClientMessageId() {
  if (
    typeof crypto === "undefined" ||
    typeof crypto.randomUUID !== "function"
  ) {
    throw new Error(
      "Trình duyệt không hỗ trợ tạo ClientMessageId an toàn."
    );
  }

  return crypto.randomUUID();
}

// =====================================================
// EXTRACT API ERROR MESSAGE
// =====================================================

export function getMessageApiError(
  error,
  fallback = "Không thể thực hiện thao tác tin nhắn."
) {
  if (error?.code === "ERR_CANCELED") {
    return null;
  }

  const serverMessage = error?.response?.data?.message;

  if (typeof serverMessage === "string" &&
      serverMessage.trim()) {
    return serverMessage;
  }

  if (!error?.response && error?.message) {
    return error.message;
  }

  return fallback;
}
