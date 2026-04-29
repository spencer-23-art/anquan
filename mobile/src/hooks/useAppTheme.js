import { useColorScheme } from 'react-native';
import { useAuthStore } from '../stores/auth';
import { darkTheme, lightTheme } from '../constants/design';

export function useAppTheme() {
  const system = useColorScheme();
  const themeMode = useAuthStore((state) => state.themeMode);
  const resolved = themeMode === 'system' ? system || 'light' : themeMode;
  return {
    mode: themeMode,
    resolved,
    colors: resolved === 'dark' ? darkTheme : lightTheme,
  };
}
