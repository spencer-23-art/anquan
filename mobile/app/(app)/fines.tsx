import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAppTheme } from '../../src/hooks/useAppTheme';
import api from '../../src/services/api';

export default function FinesScreen() {
  const { colors } = useAppTheme();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [message, setMessage] = useState('');
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    penalty_type: 'safety',
    area_id: '',
    project_name: '',
    team_name: '',
    location: '',
    discovery_date: today,
    amount: '200',
    description: '',
  });

  const loadData = async () => {
    setLoading(true);
    setMessage('');
    try {
      const [historyRes, areaRes] = await Promise.all([api.get('fines/history'), api.get('areas')]);
      const areaList = areaRes.data || [];
      setItems(historyRes.data || []);
      setForm((current) => ({ ...current, area_id: current.area_id || String(areaList[0]?.id || '') }));
    } catch (err: any) {
      setMessage(err.response?.data?.detail || '罚单加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const createFine = async () => {
    setSaving(true);
    setMessage('');
    try {
      const data = new FormData();
      Object.entries(form).forEach(([key, value]) => {
        if (value !== '') data.append(key, value);
      });
      await api.post('fines', data, { headers: { 'Content-Type': 'multipart/form-data' } });
      setShowCreate(false);
      setForm((current) => ({ ...current, team_name: '', location: '', amount: '200', description: '' }));
      await loadData();
    } catch (err: any) {
      setMessage(err.response?.data?.detail || '罚单创建失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[styles.page, { backgroundColor: colors.bg }]}>
      <View style={[styles.notice, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.noticeTitle, { color: colors.text }]}>在线罚单</Text>
        <Text style={[styles.noticeText, { color: colors.subtext }]}>客户端可开具基础罚单，也可以查看自己开具的历史记录。</Text>
      </View>
      <TouchableOpacity style={[styles.createButton, { backgroundColor: colors.primary }]} onPress={() => setShowCreate(true)}>
        <Text style={styles.createText}>新建罚单</Text>
      </TouchableOpacity>
      {message ? <Text style={[styles.message, { color: colors.danger }]}>{message}</Text> : null}
      {loading ? <ActivityIndicator color={colors.primary} style={{ marginTop: 30 }} /> : (
        <FlatList
          data={items}
          keyExtractor={(item) => String(item.id)}
          onRefresh={loadData}
          refreshing={loading}
          contentContainerStyle={{ paddingBottom: 24 }}
          ListEmptyComponent={<Text style={[styles.empty, { color: colors.subtext }]}>暂无罚单记录</Text>}
          renderItem={({ item }) => (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.rowBetween}>
                <Text style={[styles.number, { color: colors.text }]}>{item.number}</Text>
                <Text style={[styles.amount, { color: colors.danger }]}>¥{item.amount}</Text>
              </View>
              <Text style={[styles.meta, { color: colors.subtext }]}>类型：{item.ticket_type === 'safety' ? '安全罚单' : '质量罚单'}</Text>
              <Text style={[styles.meta, { color: colors.subtext }]}>班组：{item.team_name || '-'}</Text>
              <Text style={[styles.meta, { color: colors.subtext }]}>部位：{item.location || '-'}</Text>
              <Text style={[styles.desc, { color: colors.text }]} numberOfLines={4}>{item.description || '暂无描述'}</Text>
            </View>
          )}
        />
      )}

      <Modal visible={showCreate} transparent animationType="slide" onRequestClose={() => setShowCreate(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: colors.card }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>新建罚单</Text>
            <View style={styles.typeRow}>
              {[
                ['safety', '安全'],
                ['quality', '质量'],
              ].map(([value, label]) => (
                <TouchableOpacity
                  key={value}
                  style={[styles.typeButton, { borderColor: form.penalty_type === value ? colors.primary : colors.border, backgroundColor: form.penalty_type === value ? colors.primarySoft : colors.cardSoft }]}
                  onPress={() => setForm({ ...form, penalty_type: value })}
                >
                  <Text style={{ color: form.penalty_type === value ? colors.primary : colors.text, fontWeight: '900' }}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput style={[styles.input, { color: colors.text, borderColor: colors.border }]} placeholder="区域ID" placeholderTextColor={colors.subtext} value={form.area_id} onChangeText={(area_id) => setForm({ ...form, area_id })} keyboardType="number-pad" />
            <TextInput style={[styles.input, { color: colors.text, borderColor: colors.border }]} placeholder="项目名称" placeholderTextColor={colors.subtext} value={form.project_name} onChangeText={(project_name) => setForm({ ...form, project_name })} />
            <TextInput style={[styles.input, { color: colors.text, borderColor: colors.border }]} placeholder="受罚班组/个人" placeholderTextColor={colors.subtext} value={form.team_name} onChangeText={(team_name) => setForm({ ...form, team_name })} />
            <TextInput style={[styles.input, { color: colors.text, borderColor: colors.border }]} placeholder="违规部位" placeholderTextColor={colors.subtext} value={form.location} onChangeText={(location) => setForm({ ...form, location })} />
            <TextInput style={[styles.input, { color: colors.text, borderColor: colors.border }]} placeholder="罚款金额" placeholderTextColor={colors.subtext} value={form.amount} onChangeText={(amount) => setForm({ ...form, amount })} keyboardType="numeric" />
            <TextInput style={[styles.textarea, { color: colors.text, borderColor: colors.border }]} placeholder="违规情况描述" placeholderTextColor={colors.subtext} value={form.description} onChangeText={(description) => setForm({ ...form, description })} multiline />
            <TouchableOpacity style={[styles.createButton, { backgroundColor: colors.primary, opacity: saving ? 0.6 : 1 }]} onPress={createFine} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.createText}>提交罚单</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowCreate(false)}><Text style={[styles.close, { color: colors.subtext }]}>取消</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 16 },
  notice: { borderWidth: 1, borderRadius: 20, padding: 16, marginBottom: 14 },
  noticeTitle: { fontSize: 20, fontWeight: '900' },
  noticeText: { marginTop: 8, lineHeight: 20 },
  message: { marginBottom: 10, fontWeight: '800' },
  createButton: { borderRadius: 16, padding: 15, alignItems: 'center', marginBottom: 14 },
  createText: { color: '#fff', fontWeight: '900' },
  card: { borderWidth: 1, borderRadius: 18, padding: 14, marginBottom: 12 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  number: { fontSize: 16, fontWeight: '900' },
  amount: { fontWeight: '900' },
  meta: { marginTop: 6, fontSize: 12 },
  desc: { marginTop: 10, lineHeight: 20 },
  empty: { marginTop: 34, textAlign: 'center' },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15,23,42,0.45)' },
  modalCard: { borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 18 },
  modalTitle: { fontSize: 20, fontWeight: '900', marginBottom: 14 },
  typeRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  typeButton: { flex: 1, borderWidth: 1, borderRadius: 14, padding: 12, alignItems: 'center' },
  input: { borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 10 },
  textarea: { borderWidth: 1, borderRadius: 14, padding: 12, minHeight: 96, marginBottom: 10, textAlignVertical: 'top' },
  close: { textAlign: 'center', padding: 12, fontWeight: '800' },
});
