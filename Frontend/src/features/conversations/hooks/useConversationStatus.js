
import { useContext } from "react";

import { ConversationStatusContext } from
  "../contexts/ConversationStatusContext";

export function useConversationStatus() {
  const context = useContext(
    ConversationStatusContext
  );

  if (!context) {
    throw new Error(
      "useConversationStatus phải được dùng " +
      "trong ConversationStatusProvider."
    );
  }

  return context;
}
