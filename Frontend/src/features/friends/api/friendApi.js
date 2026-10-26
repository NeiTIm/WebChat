import axiosClient from "../../../api/axiosClient";

export const friendApi = {
  async sendRequest(receiverId) {
    const response = await axiosClient.post(
      "/api/friends/requests",
      { receiverId }
    );

    return response.data;
  },

  async getReceived(page = 1, pageSize = 20, signal) {
    const response = await axiosClient.get(
      "/api/friends/requests/received",
      {
        params: { page, pageSize },
        signal,
      }
    );

    return response.data;
  },

  async getSent(page = 1, pageSize = 20, signal) {
    const response = await axiosClient.get(
      "/api/friends/requests/sent",
      {
        params: { page, pageSize },
        signal,
      }
    );

    return response.data;
  },

  async acceptRequest(requestId) {
    const response = await axiosClient.post(
      `/api/friends/requests/${requestId}/accept`
    );

    return response.data;
  },

  async rejectRequest(requestId) {
    const response = await axiosClient.post(
      `/api/friends/requests/${requestId}/reject`
    );

    return response.data;
  },

  async cancelRequest(requestId) {
    const response = await axiosClient.post(
      `/api/friends/requests/${requestId}/cancel`
    );

    return response.data;
  },

  async getFriends(page = 1, pageSize = 20, signal) {
    const response = await axiosClient.get(
      "/api/friends",
      {
        params: { page, pageSize },
        signal,
      }
    );

    return response.data;
  },

  async removeFriend(userId) {
    await axiosClient.delete(`/api/friends/${userId}`);
  },

  async blockUser(userId) {
    await axiosClient.post(
      `/api/friends/blocks/${userId}`
    );
  },

  async unblockUser(userId) {
    await axiosClient.delete(
      `/api/friends/blocks/${userId}`
    );
  },

  async getBlocked(page = 1, pageSize = 20, signal) {
    const response = await axiosClient.get(
      "/api/friends/blocks",
      {
        params: { page, pageSize },
        signal,
      }
    );

    return response.data;
  },

  // =====================================================
  // USER RELATIONSHIP STATUS (BATCH)
  // =====================================================

  async getStatuses(userIds, signal) {
    const response = await axiosClient.post(
      "/api/friends/statuses",
      { userIds },
      { signal }
    );

    return response.data;
  },
};

export function getFriendError(error) {
  const message = error?.response?.data?.message;

  if (typeof message === "string" && message.trim()) {
    return message;
  }

  if (error?.response?.status === 401) {
    return "Phiên đăng nhập không hợp lệ hoặc đã hết hạn.";
  }

  if (error?.response?.status === 409) {
    return "Quan hệ này đã thay đổi. Vui lòng tải lại danh sách.";
  }

  if (!error?.response) {
    return "Không thể kết nối máy chủ. Vui lòng kiểm tra Backend.";
  }

  return "Có lỗi xảy ra. Vui lòng thử lại.";
}