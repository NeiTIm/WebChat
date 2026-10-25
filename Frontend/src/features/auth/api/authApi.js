import axiosClient from "../../../api/axiosClient";

let refreshPromise = null;

export const authApi = {
  async register(data) {
    const response = await axiosClient.post(
      "/api/auth/register",
      data
    );

    return response.data;
  },

  async login(identifier, password) {
    const response = await axiosClient.post(
      "/api/auth/login",
      {
        identifier,
        password,
      }
    );

    return response.data;
  },

  refresh() {
    if (!refreshPromise) {
      refreshPromise = axiosClient
        .post("/api/auth/refresh")
        .then((response) => response.data)
        .finally(() => {
          refreshPromise = null;
        });
    }

    return refreshPromise;
  },

  async getMe() {
    const response = await axiosClient.get(
      "/api/auth/me"
    );

    return response.data;
  },

  async logout() {
    const response = await axiosClient.post(
      "/api/auth/logout"
    );

    return response.data;
  },
};

export function getAuthError(error) {
  const data = error?.response?.data;

  if (data?.errors) {
    const messages = Object.values(data.errors)
      .flat()
      .filter(Boolean);

    if (messages.length > 0) {
      return messages.join(" ");
    }
  }

  if (typeof data?.message === "string") {
    return data.message;
  }

  if (typeof data?.title === "string") {
    return data.title;
  }

  if (error?.response?.status === 401) {
    return "Phiên đăng nhập không hợp lệ hoặc đã hết hạn.";
  }

  if (error?.response?.status === 409) {
    return "Username hoặc email đã được sử dụng.";
  }

  if (!error?.response) {
    return "Không thể kết nối máy chủ. Hãy kiểm tra Backend.";
  }

  return "Đã xảy ra lỗi. Vui lòng thử lại.";
}