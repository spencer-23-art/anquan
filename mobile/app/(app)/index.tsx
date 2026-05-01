import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { CalendarDays, ClipboardCheck, FileCheck, FileText, Settings, ShieldCheck } from 'lucide-react-native';
import api from '../../src/services/api';
import { useAuthStore } from '../../src/stores/auth';
import { useAppTheme } from '../../src/hooks/useAppTheme';

function statusText(status: string) {
  if (status === 'completed') return '已完成';
  if (status === 'in_progress') return '进行中';
  return '待排查';
}

function severityText(severity: string) {
  if (severity === 'high') return '高风险';
  if (severity === 'medium') return '中风险';
  return '低风险';
}

export default function ClientHomeScreen() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const { colors } = useAppTheme();
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  const loadTasks = async () => {
    setLoading(true);
    setMessage('');
    try {
      const res = await api.get('tasks');
      setTasks(res.data || []);
    } catch (err: any) {
      setMessage(err.response?.data?.detail || '任务加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTasks();
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadTasks();
    }, [])
  );

  const pendingCount = tasks.filter((item) => item.status !== 'completed').length;

  const renderTask = ({ item }: { item: any }) => {
    const total = item.checklist_items?.length || 0;
    const done = item.checklist_items?.filter((check: any) => check.status === 'checked').length || 0;
    const highCount = item.checklist_items?.filter((check: any) => check.severity === 'high').length || 0;
    const firstItems = (item.checklist_items || []).slice(0, 2);
    return (
      <TouchableOpacity style={[styles.taskCard, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => router.push(`/(app)/task/${item.id}`)}>
        <View style={styles.taskHeader}>
          <Text style={[styles.taskTitle, { color: colors.text }]} numberOfLines={2}>{item.title}</Text>
          <Text style={[styles.badge, { color: item.status === 'completed' ? colors.primary : colors.amber, backgroundColor: item.status === 'completed' ? colors.primarySoft : '#fef3c7' }]}>
            {statusText(item.status)}
          </Text>
        </View>
        <Text style={[styles.taskDesc, { color: colors.subtext }]} numberOfLines={2}>{item.description || '管理员下发的现场风险排查任务'}</Text>
        <View style={styles.riskList}>
          {firstItems.map((check: any, index: number) => (
            <View key={check.id || index} style={[styles.riskPreview, { backgroundColor: colors.cardSoft }]}>
              <Text style={[styles.riskPreviewTitle, { color: colors.text }]} numberOfLines={2}>{index + 1}. {check.risk_description || '待排查风险'}</Text>
              <Text style={[styles.riskPreviewSub, { color: colors.subtext }]} numberOfLines={2}>排查：{check.inspection_points || check.measure || '进入详情查看排查要求'}</Text>
            </View>
          ))}
        </View>
        <View style={styles.metaRow}>
          <Text style={[styles.meta, { color: colors.subtext }]}>区域：{item.area?.name || '-'}</Text>
          <Text style={[styles.meta, { color: colors.primary }]}>进度 {done}/{total}</Text>
        </View>
        <View style={styles.tagRow}>
          <Text style={[styles.tag, { color: colors.danger, backgroundColor: `${colors.danger}14` }]}>{highCount} 项高风险</Text>
          <Text style={[styles.tag, { color: colors.primary, backgroundColor: colors.primarySoft }]}>必须现场拍照</Text>
          {firstItems[0]?.severity ? <Text style={[styles.tag, { color: colors.subtext, backgroundColor: colors.cardSoft }]}>{severityText(firstItems[0].severity)}</Text> : null}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.page, { backgroundColor: colors.bg }]}>
      <View style={[styles.hero, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[styles.heroIcon, { backgroundColor: colors.primarySoft }]}>
          <ShieldCheck color={colors.primary} size={28} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.hello, { color: colors.text }]}>安全员工作台</Text>
          <Text style={[styles.sub, { color: colors.subtext }]}>{user?.real_name || user?.username || '安全员'}，你有 {pendingCount} 项待排查任务</Text>
        </View>
      </View>

      <View style={styles.navGrid}>
        <TouchableOpacity style={[styles.navCard, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => router.push('/(app)')}>
          <ClipboardCheck color={colors.primary} size={22} />
          <Text style={[styles.navText, { color: colors.text }]}>安全任务</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.navCard, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => router.push('/(app)/permits')}>
          <FileCheck color={colors.primary} size={22} />
          <Text style={[styles.navText, { color: colors.text }]}>作业许可</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.navCard, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => router.push('/(app)/fines')}>
          <FileText color={colors.primary} size={22} />
          <Text style={[styles.navText, { color: colors.text }]}>在线罚单</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.navCard, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => router.push('/(app)/safety-log' as any)}>
          <CalendarDays color={colors.primary} size={22} />
          <Text style={[styles.navText, { color: colors.text }]}>安全日志</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.navCard, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => router.push('/(app)/settings')}>
          <Settings color={colors.primary} size={22} />
          <Text style={[styles.navText, { color: colors.text }]}>设置</Text>
        </TouchableOpacity>
      </View>

      <Text style={[styles.sectionTitle, { color: colors.text }]}>分发给我的安全任务</Text>
      {message ? <Text style={[styles.message, { color: colors.danger }]}>{message}</Text> : null}
      {loading ? (
        <View style={styles.loader}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <FlatList
          data={tasks}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderTask}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={loadTasks} />}
          contentContainerStyle={{ paddingBottom: 28 }}
          ListEmptyComponent={<Text style={[styles.empty, { color: colors.subtext }]}>暂无管理员分发的任务</Text>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 16 },
  hero: { borderWidth: 1, borderRadius: 24, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  heroIcon: { width: 54, height: 54, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  hello: { fontSize: 22, fontWeight: '900' },
  sub: { marginTop: 5, fontSize: 13, lineHeight: 20 },
  navGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  navCard: { width: '48%', borderWidth: 1, borderRadius: 18, padding: 14, gap: 8 },
  navText: { fontWeight: '800' },
  sectionTitle: { fontSize: 18, fontWeight: '900', marginBottom: 10 },
  loader: { padding: 30 },
  taskCard: { borderWidth: 1, borderRadius: 20, padding: 16, marginBottom: 12 },
  taskHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  taskTitle: { flex: 1, fontSize: 16, fontWeight: '900' },
  badge: { overflow: 'hidden', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, fontSize: 12, fontWeight: '800' },
  taskDesc: { marginTop: 8, fontSize: 13, lineHeight: 20 },
  riskList: { marginTop: 12, gap: 8 },
  riskPreview: { borderRadius: 14, padding: 10 },
  riskPreviewTitle: { fontSize: 13, fontWeight: '900', lineHeight: 18 },
  riskPreviewSub: { marginTop: 4, fontSize: 12, lineHeight: 17 },
  metaRow: { marginTop: 12, flexDirection: 'row', justifyContent: 'space-between' },
  meta: { fontSize: 12, fontWeight: '700' },
  tagRow: { marginTop: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { overflow: 'hidden', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, fontSize: 11, fontWeight: '900' },
  message: { marginBottom: 10, fontWeight: '700' },
  empty: { textAlign: 'center', marginTop: 34 },
});
