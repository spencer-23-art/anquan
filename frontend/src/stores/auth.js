import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const normalizeUser = (user) => {
  if (!user) return null;
  return { ...user, role: String(user.role || '').toLowerCase() };
};

export const useAuthStore = create(
  persist(
    (set) => ({
      user: normalizeUser(JSON.parse(localStorage.getItem('user') || 'null')),
      token: localStorage.getItem('token') || null,
      isAuthenticated: !!localStorage.getItem('token'),

      login: (user, token) => {
        const normalizedUser = normalizeUser(user);
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(normalizedUser));
        set({ user: normalizedUser, token, isAuthenticated: true });
      },

      logout: () => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        set({ user: null, token: null, isAuthenticated: false });
      },

      setToken: (token) => {
        localStorage.setItem('token', token);
        set({ token, isAuthenticated: !!token });
      }
    }),
    {
      name: 'auth-storage',
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...persistedState,
        user: normalizeUser(persistedState?.user),
      }),
    }
  )
);

export default useAuthStore;
