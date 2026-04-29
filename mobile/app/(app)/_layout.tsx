import { Stack, useRouter } from 'expo-router';
import { TouchableOpacity, Text } from 'react-native';
import { LogOut } from 'lucide-react-native';
import { useAuthStore } from '../../src/stores/auth';
import { useAppTheme } from '../../src/hooks/useAppTheme';

export default function AppLayout() {
  const router = useRouter();
  const logout = useAuthStore((state) => state.logout);
  const { colors } = useAppTheme();

  const handleLogout = async () => {
    await logout();
    router.replace('/(auth)/login');
  };

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.card },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '800' },
        headerShadowVisible: false,
        headerRight: () => (
          <TouchableOpacity onPress={handleLogout} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <LogOut size={16} color={colors.danger} />
            <Text style={{ color: colors.danger, fontWeight: '700' }}>退出</Text>
          </TouchableOpacity>
        ),
      }}
    >
      <Stack.Screen name="index" options={{ title: '客户端' }} />
      <Stack.Screen name="task/[id]" options={{ title: '风险排查' }} />
      <Stack.Screen name="permits" options={{ title: '作业许可' }} />
      <Stack.Screen name="fines" options={{ title: '在线罚单' }} />
      <Stack.Screen name="settings" options={{ title: '设置' }} />
    </Stack>
  );
}
