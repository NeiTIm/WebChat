
import axiosClient from "../../../api/axiosClient";

// =====================================================
// CONFIG
// =====================================================

const BASE_URL = "/api/conversations";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

function validateGuid(value, fieldName) {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ||
    value === "00000000-0000-0000-0000-000000000000"
  ) {
    throw new Error(`${fieldName} không hợp lệ.`);
  }
}

function validatePagination(page, pageSize) {
  if (!Number.isInteger(page) || page < 1) {
    throw new Error("Page phải lớn hơn hoặc bằng 1.");
  }

  if (
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > MAX_PAGE_SIZE
  ) {
    throw new Error("PageSize phải nằm trong khoảng 1 đến 50.");
  }
}

// =====================================================
// GET MY CONVERSATIONS
// GET /api/conversations?page=1&pageSize=20
// =====================================================

export async function getMyConversations({
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
  signal,
} = {}) {
  validatePagination(page, pageSize);

  const response = await axiosClient.get(BASE_URL, {
    params: {
      page,
      pageSize,
    },
    signal,
  });

  return response.data;
}

// =====================================================
// GET CONVERSATION DETAILS
// GET /api/conversations/{conversationId}
// =====================================================

export async function getConversationById(
  conversationId,
  { signal } = {}
) {
  validateGuid(conversationId, "ConversationId");

  const response = await axiosClient.get(
    `${BASE_URL}/${conversationId}`,
    { signal }
  );

  return response.data;
}

// =====================================================
// OPEN OR CREATE PRIVATE CONVERSATION
// POST /api/conversations/private
// =====================================================

export async function openPrivateConversation(
  targetUserId,
  { signal } = {}
) {
  validateGuid(targetUserId, "TargetUserId");

  const response = await axiosClient.post(
    `${BASE_URL}/private`,
    {
      targetUserId,
    },
    { signal }
  );

  return response.data;
}

// =====================================================
// EXTRACT API ERROR MESSAGE
// =====================================================

export function getConversationApiError(
  error,
  fallback = "Không thể tải dữ liệu hội thoại."
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
