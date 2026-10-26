
import axiosClient from "../../../api/axiosClient";

// GUID có đúng 5 nhóm:
// 8-4-4-4-12
const GUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EMPTY_GUID =
  "00000000-0000-0000-0000-000000000000";

function validateConversationId(conversationId) {
  if (
    typeof conversationId !== "string" ||
    !GUID_PATTERN.test(conversationId) ||
    conversationId.toLowerCase() === EMPTY_GUID
  ) {
    throw new Error(
      "ConversationId không hợp lệ."
    );
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
    {
      lastDeliveredSequence,
    },
    {
      signal,
    }
  );

  const data = response.data;

  if (
    !data ||
    String(data.conversationId).toLowerCase() !==
      conversationId.toLowerCase() ||
    !Number.isSafeInteger(data.lastDeliveredSequence) ||
    data.lastDeliveredSequence < lastDeliveredSequence
  ) {
    throw new Error(
      "Delivered response không hợp lệ."
    );
  }

  return data;
}

export async function getDeliveryCursorPage({
  page = 1,
  pageSize = 50,
  signal,
} = {}) {
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 50
  ) {
    throw new Error(
      "Pagination không hợp lệ."
    );
  }

  const response = await axiosClient.get(
    "/api/delivery/cursors",
    {
      params: {
        page,
        pageSize,
      },
      signal,
    }
  );

  return response.data;
}
