import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAuthStore } from '../../src/stores/auth';
import { useAppTheme } from '../../src/hooks/useAppTheme';

const modes = [
  { value: 'light', label: '白天模式' },
  { value: 'dark', label: '暗黑模式' },
  { value: 'system', label: '跟随系统' },
];

export default function SettingsScreen() {
  const { colors, mode } = useAppTheme();
  const setThemeMode = useAuthStore((state) => state.setThemeMode);

  return (
    <View style={[styles.page, { backgroundColor: colors.bg }]}>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.text }]}>显示设置</Text>
        <Text style={[styles.sub, { color: colors.subtext }]}>客户端只保留显示模式设置，其他系统配置统一在后台管理。</Text>
        <View style={styles.options}>
          {modes.map((item) => {
            const active = mode === item.value;
            return (
              <TouchableOpacity
                key={item.value}
                style={[styles.option, { borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primarySoft : colors.cardSoft }]}
                onPress={() => setThemeMode(item.value)}
              >
                <Text style={[styles.optionText, { color: active ? colors.primary : colors.text }]}>{item.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 16 },
  card: { borderWidth: 1, borderRadius: 22, padding: 18 },
  title: { fontSize: 20, fontWeight: '900' },
  sub: { marginTop: 8, lineHeight: 20 },
  options: { marginTop: 18, gap: 10 },
  option: { borderWidth: 1, borderRadius: 16, padding: 15 },
  optionText: { fontWeight: '900' },
});
