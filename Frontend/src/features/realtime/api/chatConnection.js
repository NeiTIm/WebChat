
import {
  HubConnectionBuilder,
  HubConnectionState,
  LogLevel,
} from "@microsoft/signalr";

import {
  getAccessToken,
  setAccessToken,
} from "../../../api/axiosClient";

import { authApi } from "../../auth/api/authApi";

// =====================================================
// CONFIG
// =====================================================

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ||
  "http://localhost:5069"
).replace(/\/+$/, "");

export const CHAT_HUB_URL =
  `${API_BASE_URL}/hubs/chat`;

const TOKEN_REFRESH_BUFFER_SECONDS = 30;

const RECONNECT_DELAYS = [
  0,
  2000,
  10000,
  30000,
];

// =====================================================
// JWT EXPIRATION
// Chỉ đọc exp để chủ động refresh.
// Backend vẫn là nơi xác thực JWT.
// =====================================================

function getTokenExpiration(token) {
  try {
    if (!token) return null;

    const parts = token.split(".");

    if (parts.length !== 3) {
      return null;
    }

    const encodedPayload = parts[1]
      .replace(/-/g, "+")
      .replace(/_/g, "/");

    const payload = JSON.parse(
      atob(encodedPayload)
    );

    return typeof payload.exp === "number"
      ? payload.exp
      : null;
  } catch {
    return null;
  }
}

// =====================================================
// ACCESS TOKEN FACTORY
// =====================================================

export function createChatAccessTokenFactory(
  isSessionActive
) {
  return async () => {
    if (!isSessionActive()) {
      throw new Error(
        "Phiên SignalR đã kết thúc."
      );
    }

    let token = getAccessToken();

    if (!token) {
      throw new Error(
        "Không có Access Token."
      );
    }

    const expiresAt = getTokenExpiration(token);

    const nowSeconds =
      Math.floor(Date.now() / 1000);

    const shouldRefresh =
      expiresAt !== null &&
      expiresAt <=
        nowSeconds + TOKEN_REFRESH_BUFFER_SECONDS;

    if (shouldRefresh) {
      // authApi.refresh() đã chống các request
      // refresh đồng thời bằng refreshPromise.
      const result = await authApi.refresh();

      // Tránh ghi token mới sau khi kết nối
      // đã bị ngắt do Logout.
      if (!isSessionActive()) {
        throw new Error(
          "Phiên SignalR đã kết thúc."
        );
      }

      if (!result?.accessToken) {
        throw new Error(
          "Không thể làm mới Access Token."
        );
      }

      token = result.accessToken;

      setAccessToken(token);
    }

    if (!isSessionActive()) {
      throw new Error(
        "Phiên SignalR đã kết thúc."
      );
    }

    return token;
  };
}

// =====================================================
// CREATE CONNECTION
// =====================================================

export function createChatConnection(
  isSessionActive
) {
  const connection = new HubConnectionBuilder()
    .withUrl(CHAT_HUB_URL, {
      accessTokenFactory:
        createChatAccessTokenFactory(
          isSessionActive
        ),
    })
    .withAutomaticReconnect(RECONNECT_DELAYS)
    .configureLogging(LogLevel.Warning)
    .build();

  return connection;
}

// =====================================================
// HELPERS
// =====================================================

export function isChatConnected(connection) {
  return (
    connection?.state ===
    HubConnectionState.Connected
  );
}

export function isChatDisconnected(connection) {
  return (
    connection?.state ===
    HubConnectionState.Disconnected
  );
}

export function getChatConnectionError(error) {
  const message =
    typeof error?.message === "string"
      ? error.message
      : "";

  if (
    message.includes("401") ||
    message.includes("Unauthorized")
  ) {
    return (
      "Phiên đăng nhập SignalR không hợp lệ " +
      "hoặc đã hết hạn."
    );
  }

  if (
    message.includes("403") ||
    message.includes("Forbidden")
  ) {
    return "Bạn không có quyền kết nối SignalR.";
  }

  if (message.includes("Access Token")) {
    return message;
  }

  if (message.includes("Failed to fetch")) {
    return (
      "Không thể kết nối Backend. " +
      "Hãy kiểm tra máy chủ."
    );
  }

  return (
    "Không thể kết nối realtime. " +
    "Bạn vẫn có thể sử dụng Chat REST."
  );
}
