import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { CalendarDays, FileText, Share2 } from 'lucide-react-native';
import { authenticatedApiUrl } from '../../src/services/api';
import { useAppTheme } from '../../src/hooks/useAppTheme';

function todayText() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isValidDateText(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
}

export default function SafetyLogScreen() {
  const { colors } = useAppTheme();
  const [dateText, setDateText] = useState(todayText());
  const [loading, setLoading] = useState(false);
  const [lastFile, setLastFile] = useState('');

  const cleanDate = useMemo(() => dateText.trim(), [dateText]);

  const generateAndShare = async () => {
    if (!isValidDateText(cleanDate)) {
      Alert.alert('日期格式不正确', '请输入 YYYY-MM-DD 格式，例如 2026-05-01。');
      return;
    }
    setLoading(true);
    try {
      const url = authenticatedApiUrl(`safety-logs/generate?log_date=${encodeURIComponent(cleanDate)}`);
      const target = `${FileSystem.documentDirectory}施工安全日志-${cleanDate}.docx`;
      const result = await FileSystem.downloadAsync(url, target);
      if (result.status < 200 || result.status >= 300) {
        throw new Error(`下载失败，状态码 ${result.status}`);
      }
      setLastFile(result.uri);
      const available = await Sharing.isAvailableAsync();
      if (!available) {
        Alert.alert('文件已生成', `文件已保存：${result.uri}`);
        return;
      }
      await Sharing.shareAsync(result.uri, {
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        dialogTitle: '分享施工安全日志',
        UTI: 'org.openxmlformats.wordprocessingml.document',
      });
    } catch (err: any) {
      Alert.alert('生成失败', err.message || '施工安全日志生成失败，请稍后重试。');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.page, { backgroundColor: colors.bg }]}>
      <View style={[styles.hero, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[styles.iconBox, { backgroundColor: colors.primarySoft }]}>
          <FileText color={colors.primary} size={28} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.text }]}>施工安全日志</Text>
          <Text style={[styles.subtitle, { color: colors.subtext }]}>选择巡查日期，自动汇总当天作业票据、隐患排查文字和照片。</Text>
        </View>
      </View>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.label, { color: colors.text }]}>导出日期</Text>
        <View style={[styles.inputRow, { borderColor: colors.border }]}>
          <CalendarDays size={18} color={colors.primary} />
          <TextInput
            style={[styles.input, { color: colors.text }]}
            value={dateText}
            onChangeText={setDateText}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.subtext}
            keyboardType="numbers-and-punctuation"
          />
        </View>
        <TouchableOpacity style={[styles.todayButton, { borderColor: colors.border }]} onPress={() => setDateText(todayText())}>
          <Text style={[styles.todayText, { color: colors.text }]}>恢复当天日期</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={[styles.shareButton, { backgroundColor: colors.primary }, loading && styles.disabled]}
        onPress={generateAndShare}
        disabled={loading}
      >
        {loading ? <ActivityIndicator color="#fff" /> : <Share2 color="#fff" size={18} />}
        <Text style={styles.shareText}>{loading ? '正在生成...' : '生成并分享到微信'}</Text>
      </TouchableOpacity>

      {lastFile ? <Text style={[styles.fileHint, { color: colors.subtext }]}>最近生成：{lastFile}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 16 },
  hero: { borderWidth: 1, borderRadius: 24, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  iconBox: { width: 54, height: 54, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '900' },
  subtitle: { marginTop: 5, fontSize: 13, lineHeight: 20 },
  card: { borderWidth: 1, borderRadius: 22, padding: 16, marginBottom: 14 },
  label: { fontSize: 15, fontWeight: '900', marginBottom: 10 },
  inputRow: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, height: 52, flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { flex: 1, fontSize: 16, fontWeight: '800' },
  todayButton: { marginTop: 10, borderWidth: 1, borderRadius: 16, padding: 13, alignItems: 'center' },
  todayText: { fontWeight: '900' },
  shareButton: { borderRadius: 18, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  shareText: { color: '#fff', fontWeight: '900', fontSize: 16 },
  disabled: { opacity: 0.65 },
  fileHint: { marginTop: 12, fontSize: 12, lineHeight: 18 },
});
