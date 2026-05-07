import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { ShieldCheck } from 'lucide-react-native';
import api from '../../src/services/api';
import { useAuthStore } from '../../src/stores/auth';
import { useAppTheme } from '../../src/hooks/useAppTheme';
import { BlurView } from 'expo-blur';

function statusText(status: string) {
  const value = String(status || '').toLowerCase();
  if (value === 'completed') return '已完成';
  if (value === 'in_progress') return '进行中';
  return '待排查';
}

function severityText(severity: string) {
  if (severity === 'high') return '高风险';
  if (severity === 'medium') return '中风险';
  return '低风险';
}

function getTaskDateValue(task: any) {
  return task.created_at || task.assigned_at || task.updated_at || new Date().toISOString();
}

function getDayKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未知日期';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getDayLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未知日期';
  return date.toLocaleDateString('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });
}

function DateDivider({ label, count, colors }: { label: string; count: number; colors: any }) {
  return (
    <View style={styles.dateDivider}>
      <View style={[styles.dateLine, { backgroundColor: colors.border }]} />
      <View style={[styles.datePill, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.dateLabel, { color: colors.text }]}>{label}</Text>
        <Text style={[styles.dateCount, { color: colors.subtext }]}>{count} 项任务</Text>
      </View>
      <View style={[styles.dateLine, { backgroundColor: colors.border }]} />
    </View>
  );
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

  const isCompleted = (status: string) => String(status || '').toLowerCase() === 'completed';
  const isChecked = (status: string) => String(status || '').toLowerCase() === 'checked';

  useEffect(() => {
    loadTasks();
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadTasks();
    }, [])
  );

  const pendingCount = tasks.filter((item) => !isCompleted(item.status)).length;

  const timelineRows = useMemo(() => {
    const sortedTasks = [...tasks].sort((a, b) => {
      const bTime = new Date(getTaskDateValue(b)).getTime() || 0;
      const aTime = new Date(getTaskDateValue(a)).getTime() || 0;
      return bTime - aTime;
    });
    const grouped = new Map<string, { label: string; items: any[] }>();

    sortedTasks.forEach((task) => {
      const dateValue = getTaskDateValue(task);
      const key = getDayKey(dateValue);
      if (!grouped.has(key)) {
        grouped.set(key, { label: getDayLabel(dateValue), items: [] });
      }
      grouped.get(key)?.items.push(task);
    });

    return Array.from(grouped.entries()).flatMap(([key, group]) => [
      { type: 'date', key: `date-${key}`, label: group.label, count: group.items.length },
      ...group.items.map((task) => ({ type: 'task', key: `task-${task.id}`, task })),
    ]);
  }, [tasks]);

  const renderTask = ({ item }: { item: any }) => {
    const total = item.checklist_items?.length || 0;
    const done = item.checklist_items?.filter((check: any) => isChecked(check.status)).length || 0;
    const highCount = item.checklist_items?.filter((check: any) => check.severity === 'high').length || 0;
    const firstItems = (item.checklist_items || []).slice(0, 2);
    return (
      <BlurView
        intensity={100}
        tint={colors.bg === '#000000' ? 'dark' : 'light'}
        style={[
          styles.taskCard,
          {
            borderColor: isCompleted(item.status) ? '#8bd6c8' : '#6fbfb1',
            backgroundColor: colors.card,
          },
        ]}
      >
        <TouchableOpacity style={[styles.taskPressArea, { backgroundColor: colors.card }]} onPress={() => router.push(`/(app)/task/${item.id}`)}>
          <View style={[styles.taskAccent, { backgroundColor: isCompleted(item.status) ? colors.primary : colors.amber }]} />
          <View style={styles.taskHeader}>
            <Text style={[styles.taskTitle, { color: colors.text }]} numberOfLines={2}>{item.title}</Text>
            <Text style={[styles.badge, { color: isCompleted(item.status) ? colors.primary : colors.amber, backgroundColor: isCompleted(item.status) ? colors.primarySoft : '#fef3c7' }]}>
              {statusText(item.status)}
            </Text>
          </View>
          <Text style={[styles.taskDesc, { color: colors.subtext }]} numberOfLines={2}>{item.description || '管理员下发的现场风险排查任务'}</Text>
          <View style={styles.riskList}>
            {firstItems.map((check: any, index: number) => (
              <View key={check.id || index} style={[styles.riskPreview, { backgroundColor: colors.cardSoft, borderColor: colors.border }]}>
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
      </BlurView>
    );
  };

  const renderTimelineRow = ({ item }: { item: any }) => {
    if (item.type === 'date') {
      return <DateDivider label={item.label} count={item.count} colors={colors} />;
    }
    return renderTask({ item: item.task });
  };

  return (
    <View style={styles.page}>
      {/* 欢迎区 */}
      <BlurView intensity={100} tint={colors.bg === '#000000' ? 'dark' : 'light'} style={{ borderRadius: 24, overflow: 'hidden', marginBottom: 14, borderWidth: 1, borderColor: colors.border }}>
        <View style={{ backgroundColor: colors.card, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={[styles.heroIcon, { backgroundColor: colors.primarySoft }]}>
            <ShieldCheck color={colors.primary} size={28} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.hello, { color: colors.text }]}>安全员工作台</Text>
            <Text style={[styles.sub, { color: colors.subtext }]}>{user?.real_name || user?.username || '安全员'}，你有 {pendingCount} 项待排查任务</Text>
          </View>
        </View>
      </BlurView>

      <Text style={[styles.sectionTitle, { color: colors.text }]}>分发给我的安全任务</Text>
      {message ? <Text style={[styles.message, { color: colors.danger }]}>{message}</Text> : null}
      {loading ? (
        <View style={styles.loader}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <FlatList
          data={timelineRows}
          keyExtractor={(item) => item.key}
          renderItem={renderTimelineRow}
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
  sectionTitle: { fontSize: 18, fontWeight: '900', marginBottom: 10 },
  loader: { padding: 30 },
  dateDivider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4, marginBottom: 12 },
  dateLine: { flex: 1, height: 1 },
  datePill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, alignItems: 'center' },
  dateLabel: { fontSize: 13, fontWeight: '900' },
  dateCount: { marginTop: 1, fontSize: 10, fontWeight: '700' },
  taskCard: {
    borderWidth: 1.5,
    borderRadius: 22,
    marginBottom: 14,
    overflow: 'hidden',
    shadowColor: '#0f766e',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 16,
    elevation: 6,
  },
  taskPressArea: { padding: 16, borderRadius: 22 },
  taskAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 5 },
  taskHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  taskTitle: { flex: 1, fontSize: 16, fontWeight: '900' },
  badge: { overflow: 'hidden', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, fontSize: 12, fontWeight: '800' },
  taskDesc: { marginTop: 8, fontSize: 13, lineHeight: 20 },
  riskList: { marginTop: 12, gap: 8 },
  riskPreview: { borderWidth: 1, borderRadius: 14, padding: 10 },
  riskPreviewTitle: { fontSize: 13, fontWeight: '900', lineHeight: 18 },
  riskPreviewSub: { marginTop: 4, fontSize: 12, lineHeight: 17 },
  metaRow: { marginTop: 12, flexDirection: 'row', justifyContent: 'space-between' },
  meta: { fontSize: 12, fontWeight: '700' },
  tagRow: { marginTop: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { overflow: 'hidden', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, fontSize: 11, fontWeight: '900' },
  message: { marginBottom: 10, fontWeight: '700' },
  empty: { textAlign: 'center', marginTop: 34 },
});
