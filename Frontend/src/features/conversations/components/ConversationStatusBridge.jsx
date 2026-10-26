
import { useEffect } from "react";

import { useConversationStatus } from
  "../hooks/useConversationStatus";

export default function ConversationStatusBridge({
  conversation,
}) {
  const { mergeConversation } =
    useConversationStatus();

  useEffect(() => {
    if (!conversation?.id) {
      return;
    }

    mergeConversation(conversation);
  }, [conversation, mergeConversation]);

  return null;
}
