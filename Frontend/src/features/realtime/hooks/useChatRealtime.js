
import { useContext } from "react";

import { ChatRealtimeContext } from
  "../contexts/ChatRealtimeContext";

export function useChatRealtime() {
  const context = useContext(
    ChatRealtimeContext
  );

  if (!context) {
    throw new Error(
      "useChatRealtime phải được sử dụng " +
      "trong ChatRealtimeProvider."
    );
  }

  return context;
}
