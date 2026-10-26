
import { getConversationMessages } from
  "../../messages/api/messageApi";

const PAGE_SIZE = 50;
const MAX_PAGES = 20;

function normalizeId(value) {
  return String(value ?? "").toLowerCase();
}

function validateResponse(result, conversationId) {
  if (
    !result ||
    !Array.isArray(result.items) ||
    normalizeId(result.conversationId) !==
      normalizeId(conversationId)
  ) {
    throw new Error(
      "REST trả về dữ liệu đồng bộ không hợp lệ."
    );
  }
}

/**
 * Quét từ tin mới nhất về mốc tin đã biết.
 *
 * knownSequence:
 *   Sequence lớn nhất trước khi đồng bộ.
 *
 * pendingClientMessageId:
 *   ClientMessageId chưa nhận ACK (nếu có).
 *
 * Nếu pending chưa được tìm thấy, tiếp tục
 * tìm sâu hơn dù đã gặp knownSequence.
 */
export async function reconcileConversationMessages({
  conversationId,
  knownSequence = 0,
  pendingClientMessageId = null,
  currentUserId = null,
  signal,
}) {
  const recovered = [];

  const seenIds = new Set();

  let beforeSequence = null;
  let complete = false;
  let pendingFound = !pendingClientMessageId;
  let pagesFetched = 0;

  for (
    let page = 0;
    page < MAX_PAGES;
    page += 1
  ) {
    if (signal?.aborted) {
      throw new Error("Reconciliation canceled.");
    }

    const result = await getConversationMessages(
      conversationId,
      {
        pageSize: PAGE_SIZE,
        beforeSequence,
        signal,
      }
    );

    validateResponse(result, conversationId);

    pagesFetched += 1;

    for (const message of result.items) {
      if (!message?.id) continue;

      const id = normalizeId(message.id);

      if (!seenIds.has(id)) {
        seenIds.add(id);
        recovered.push(message);
      }

      if (
        pendingClientMessageId &&
        normalizeId(message.clientMessageId) ===
          normalizeId(pendingClientMessageId) &&
        normalizeId(message.senderId) ===
          normalizeId(currentUserId)
      ) {
        pendingFound = true;
      }
    }

    const reachedKnownBoundary =
      knownSequence > 0 &&
      result.items.some(
        (message) =>
          message.sequenceNumber <= knownSequence
      );

    if (!result.hasMore) {
      complete = true;
      break;
    }

    if (reachedKnownBoundary && pendingFound) {
      complete = true;
      break;
    }

    const nextCursor =
      result.nextBeforeSequence;

    if (
      !Number.isSafeInteger(nextCursor) ||
      nextCursor <= 0 ||
      (
        beforeSequence !== null &&
        nextCursor >= beforeSequence
      )
    ) {
      throw new Error(
        "Cursor đồng bộ tin nhắn không hợp lệ."
      );
    }

    if (result.items.length === 0) {
      throw new Error(
        "Trang đồng bộ trống nhưng còn dữ liệu."
      );
    }

    beforeSequence = nextCursor;
  }

  return {
    messages: recovered,
    complete,
    pendingFound,
    pagesFetched,
  };
}
