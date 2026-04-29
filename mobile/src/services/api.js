import axios from 'axios';
import { useAuthStore } from '../stores/auth';

const configuredUrl = process.env.EXPO_PUBLIC_API_URL;
const BASE_URL = configuredUrl?.endsWith('/api/')
  ? configuredUrl
  : configuredUrl?.endsWith('/api')
    ? `${configuredUrl}/`
    : configuredUrl
      ? `${configuredUrl.replace(/\/$/, '')}/api/`
      : 'http://8.137.13.118:8000/api/';

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 120000,
});

api.interceptors.request.use(async (config) => {
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

export function protectedFileUrl(path) {
  if (!path) return '';
  const token = useAuthStore.getState().token;
  const filePath = String(path).replace(/^\/?uploads\/?/, '');
  const root = BASE_URL.replace(/\/api\/?$/, '');
  return `${root}/api/files/${filePath}?token=${encodeURIComponent(token || '')}`;
}

export default api;
