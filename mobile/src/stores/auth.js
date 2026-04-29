import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const useAuthStore = create((set, get) => ({
  token: null,
  user: null,
  pushToken: null,
  themeMode: 'system',
  isRestored: false,

  restoreToken: async () => {
    try {
      const token = await AsyncStorage.getItem('safe_token');
      const userText = await AsyncStorage.getItem('safe_user');
      const themeMode = await AsyncStorage.getItem('safe_theme_mode');
      set({
        token,
        user: userText ? JSON.parse(userText) : null,
        themeMode: themeMode || 'system',
        isRestored: true,
      });
    } catch {
      set({ isRestored: true });
    }
  },

  setToken: async (token, user = null) => {
    await AsyncStorage.setItem('safe_token', token);
    if (user) {
      await AsyncStorage.setItem('safe_user', JSON.stringify(user));
    }
    set({ token, user });
  },

  setPushToken: (token) => set({ pushToken: token }),
  setThemeMode: async (themeMode) => {
    await AsyncStorage.setItem('safe_theme_mode', themeMode);
    set({ themeMode });
  },

  logout: async () => {
    await AsyncStorage.removeItem('safe_token');
    await AsyncStorage.removeItem('safe_user');
    set({ token: null, user: null });
  }
}));
