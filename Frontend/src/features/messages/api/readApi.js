
import axiosClient from "../../../api/axiosClient";

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
    throw new Error("ConversationId không hợp lệ.");
  }
}

export async function markAsRead(
  conversationId,
  lastReadSequence,
  { signal } = {}
) {
  validateConversationId(conversationId);

  if (
    !Number.isSafeInteger(lastReadSequence) ||
    lastReadSequence <= 0
  ) {
    throw new Error(
      "LastReadSequence không hợp lệ."
    );
  }

  const response = await axiosClient.post(
    `/api/conversations/${conversationId}/read`,
    { lastReadSequence },
    { signal }
  );

  const data = response.data;

  if (
    !data ||
    String(data.conversationId).toLowerCase() !==
      conversationId.toLowerCase() ||
    !Number.isSafeInteger(data.lastReadSequence) ||
    data.lastReadSequence < lastReadSequence
  ) {
    throw new Error(
      "Mark as Read response không hợp lệ."
    );
  }

  return data;
}
