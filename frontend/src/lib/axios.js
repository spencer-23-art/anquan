import axios from "axios";
import { useAuthStore } from "../stores/auth";

const API_BASE_URL = "/api";
const FILES_BASE_URL = "/api/files";

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 120000,
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      useAuthStore.getState().logout();
    }
    return Promise.reject(error);
  }
);

export function getAuthToken() {
  return useAuthStore.getState().token;
}

export function buildProtectedFileUrl(filePath) {
  if (!filePath) {
    return "";
  }
  const token = getAuthToken();
  const relativePath = String(filePath).replace(/^\/?uploads\/?/, "");
  return `${FILES_BASE_URL}/${relativePath}?token=${encodeURIComponent(token || "")}`;
}

export default api;
