
export function isValidSequence(value) {
  return (
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

export function normalizeSequence(value) {
  return isValidSequence(value)
    ? value
    : null;
}

export function findContiguousCursor({
  baseline,
  target,
  messages,
  conversationId,
}) {
  if (
    !isValidSequence(baseline) ||
    !isValidSequence(target) ||
    target < baseline ||
    !Array.isArray(messages)
  ) {
    return baseline;
  }

  const expectedConversationId =
    String(conversationId).toLowerCase();

  const received = new Set();

  for (const message of messages) {
    if (!message) continue;

    if (
      String(message.conversationId).toLowerCase() !==
      expectedConversationId
    ) {
      continue;
    }

    const sequence = message.sequenceNumber;

    if (
      !Number.isSafeInteger(sequence) ||
      sequence <= baseline ||
      sequence > target
    ) {
      continue;
    }

    received.add(sequence);
  }

  let cursor = baseline;

  while (
    cursor < target &&
    received.has(cursor + 1)
  ) {
    cursor += 1;
  }

  return cursor;
}
