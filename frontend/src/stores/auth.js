import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useAuthStore = create(
  persist(
    (set, get) => ({
      user: JSON.parse(localStorage.getItem('user') || 'null'),
      token: localStorage.getItem('token') || null,
      isAuthenticated: !!localStorage.getItem('token'),
      
      login: (user, token) => {
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(user));
        set({ user, token, isAuthenticated: true });
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
    }
  )
);

export default useAuthStore;