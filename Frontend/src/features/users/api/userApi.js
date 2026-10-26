import axiosClient from "../../../api/axiosClient";

export const userApi = {
  async getMyProfile() {
    const response = await axiosClient.get("/api/users/me");
    return response.data;
  },

  async updateMyProfile(payload) {
    const response = await axiosClient.put(
      "/api/users/me",
      payload
    );

    return response.data;
  },

  async searchUsers({
    query,
    page = 1,
    pageSize = 20,
    signal,
  }) {
    const response = await axiosClient.get(
      "/api/users/search",
      {
        params: {
          q: query,
          page,
          pageSize,
        },
        signal,
      }
    );

    return response.data;
  },
};