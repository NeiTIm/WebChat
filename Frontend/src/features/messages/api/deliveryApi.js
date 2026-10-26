
import axiosClient from "../../../api/axiosClient";

const GUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateConversationId(conversationId) {
  if (
    typeof conversationId !== "string" ||
    !GUID_PATTERN.test(conversationId) ||
    conversationId ===
      "00000000-0000-0000-0000-000000000000"
  ) {
    throw new Error("ConversationId không hợp lệ.");
  }
}

export async function markAsDelivered(
  conversationId,
  lastDeliveredSequence,
  { signal } = {}
) {
  validateConversationId(conversationId);

  if (
    !Number.isSafeInteger(lastDeliveredSequence) ||
    lastDeliveredSequence <= 0
  ) {
    throw new Error(
      "LastDeliveredSequence không hợp lệ."
    );
  }

  const response = await axiosClient.post(
    `/api/conversations/${conversationId}/delivered`,
    { lastDeliveredSequence },
    { signal }
  );

  return response.data;
}

export async function getDeliveryCursorPage({
  page = 1,
  pageSize = 50,
  signal,
} = {}) {
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 50
  ) {
    throw new Error(
      "Pagination Delivery Cursor không hợp lệ."
    );
  }

  const response = await axiosClient.get(
    "/api/delivery/cursors",
    {
      params: { page, pageSize },
      signal,
    }
  );

  return response.data;
}
