import { create } from 'zustand';

const TOKEN_KEY = 'token';
const USER_KEY = 'user';
const REMEMBER_KEY = 'safe_remember_login';

const normalizeUser = (user) => {
  if (!user) return null;
  return { ...user, role: String(user.role || '').toLowerCase() };
};

const readUser = (storage) => {
  try {
    return normalizeUser(JSON.parse(storage.getItem(USER_KEY) || 'null'));
  } catch {
    return null;
  }
};

const clearAuthStorage = () => {
  [localStorage, sessionStorage].forEach((storage) => {
    storage.removeItem(TOKEN_KEY);
    storage.removeItem(USER_KEY);
  });
  localStorage.removeItem(REMEMBER_KEY);
};

const remembered = localStorage.getItem(REMEMBER_KEY) === 'true' || !!localStorage.getItem(TOKEN_KEY);
const activeStorage = remembered ? localStorage : sessionStorage;
const initialToken = activeStorage.getItem(TOKEN_KEY) || null;
const initialUser = readUser(activeStorage);

export const useAuthStore = create((set, get) => ({
  user: initialUser,
  token: initialToken,
  isAuthenticated: !!initialToken,
  rememberLogin: remembered,

  login: (user, token, remember = false) => {
    const normalizedUser = normalizeUser(user);
    clearAuthStorage();
    const storage = remember ? localStorage : sessionStorage;
    storage.setItem(TOKEN_KEY, token);
    storage.setItem(USER_KEY, JSON.stringify(normalizedUser));
    if (remember) {
      localStorage.setItem(REMEMBER_KEY, 'true');
    }
    set({ user: normalizedUser, token, isAuthenticated: true, rememberLogin: remember });
  },

  logout: () => {
    clearAuthStorage();
    set({ user: null, token: null, isAuthenticated: false, rememberLogin: false });
  },

  setToken: (token) => {
    const remember = get().rememberLogin;
    const storage = remember ? localStorage : sessionStorage;
    if (token) {
      storage.setItem(TOKEN_KEY, token);
      if (remember) {
        localStorage.setItem(REMEMBER_KEY, 'true');
      }
    } else {
      clearAuthStorage();
    }
    set({ token, isAuthenticated: !!token });
  },
}));

export default useAuthStore;
