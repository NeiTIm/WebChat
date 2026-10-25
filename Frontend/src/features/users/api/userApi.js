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
};