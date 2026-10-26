
export function normalizeStatusId(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function validCursor(value) {
  return (
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

const CURSOR_FIELDS = [
  "myLastReadSequence",
  "otherLastReadSequence",
  "myLastDeliveredSequence",
  "otherLastDeliveredSequence",
];

export function normalizeConversationStatus(dto) {
  const conversationId = normalizeStatusId(dto?.id);
  const otherUserId = normalizeStatusId(dto?.otherUserId);

  if (!conversationId || !otherUserId) {
    return null;
  }

  // Không mặc định cursor thiếu thành 0.
  // REST phải trả đầy đủ hợp đồng 5.8E1.
  if (
    !CURSOR_FIELDS.every((field) =>
      validCursor(dto?.[field])
    )
  ) {
    return null;
  }

  return {
    conversationId,
    otherUserId,
    myLastReadSequence: dto.myLastReadSequence,
    otherLastReadSequence: dto.otherLastReadSequence,
    myLastDeliveredSequence:
      dto.myLastDeliveredSequence,
    otherLastDeliveredSequence:
      dto.otherLastDeliveredSequence,
  };
}

export function mergeConversationStatus(
  previous,
  incoming
) {
  if (!incoming) return previous;

  if (!previous) {
    return incoming;
  }

  if (
    previous.conversationId !== incoming.conversationId ||
    previous.otherUserId !== incoming.otherUserId
  ) {
    // Metadata không khớp: không đoán người nhận.
    return previous;
  }

  let changed = false;

  const next = { ...previous };

  for (const field of CURSOR_FIELDS) {
    const oldValue = previous[field];
    const incomingValue = incoming[field];

    if (
      validCursor(incomingValue) &&
      incomingValue > oldValue
    ) {
      next[field] = incomingValue;
      changed = true;
    }
  }

  return changed ? next : previous;
}

export function applyStatusEvent(
  previous,
  eventName,
  payload,
  currentUserId
) {
  if (!previous || !payload) return previous;

  const conversationId =
    normalizeStatusId(payload.conversationId);

  const myId = normalizeStatusId(currentUserId);

  if (
    !conversationId ||
    !myId ||
    conversationId !== previous.conversationId
  ) {
    return previous;
  }

  let eventUserId;
  let sequence;
  let myField;
  let otherField;

  if (eventName === "MessageReadUpdated") {
    eventUserId = normalizeStatusId(
      payload.readerUserId
    );
    sequence = payload.lastReadSequence;
    myField = "myLastReadSequence";
    otherField = "otherLastReadSequence";
  } else if (
    eventName === "MessageDeliveredUpdated"
  ) {
    eventUserId = normalizeStatusId(
      payload.recipientUserId
    );
    sequence = payload.lastDeliveredSequence;
    myField = "myLastDeliveredSequence";
    otherField = "otherLastDeliveredSequence";
  } else {
    return previous;
  }

  if (
    !eventUserId ||
    !validCursor(sequence) ||
    sequence === 0
  ) {
    return previous;
  }

  let field;

  if (eventUserId === myId) {
    field = myField;
  } else if (
    eventUserId === previous.otherUserId
  ) {
    field = otherField;
  } else {
    return previous;
  }

  if (sequence <= previous[field]) {
    return previous;
  }

  return {
    ...previous,
    [field]: sequence,
  };
}
