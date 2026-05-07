import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { Camera, Sparkles, X } from 'lucide-react-native';
import api from '../../src/services/api';
import { useAppTheme } from '../../src/hooks/useAppTheme';

const amountChoices = [200, 300, 500, 1000, 2000, 5000];

const defaultForm = {
  penalty_type: 'safety',
  area_id: '',
  project_name: '',
  team_name: '',
  location: '',
  discovery_date: new Date().toISOString().slice(0, 10),
  amount: '200',
  description: '',
};

async function compressPhoto(uri: string) {
  return manipulateAsync(uri, [{ resize: { width: 1200 } }], {
    compress: 0.6,
    format: SaveFormat.JPEG,
  });
}

export default function FinesScreen() {
  const { colors } = useAppTheme();
  const [items, setItems] = useState<any[]>([]);
  const [areas, setAreas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generatingAI, setGeneratingAI] = useState(false);
  const [activeTab, setActiveTab] = useState<'create' | 'history'>('create');
  const [message, setMessage] = useState('');
  const [form, setForm] = useState(defaultForm);
  const [summaryInput, setSummaryInput] = useState('');
  const [photo, setPhoto] = useState<{ uri: string } | null>(null);

  const loadData = async () => {
    setLoading(true);
    setMessage('');
    try {
      const [historyRes, areaRes] = await Promise.all([
        api.get('fines/history'),
        api.get('areas'),
      ]);
      const areaList = areaRes.data || [];
      setItems(historyRes.data || []);
      setAreas(areaList);
      setForm((cur) => ({
        ...cur,
        area_id: cur.area_id || String(areaList[0]?.id || ''),
      }));
    } catch (err: any) {
      setMessage(err.response?.data?.detail || '罚单加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const openPhotoMenu = () => {
    Alert.alert('添加照片', '请选择照片来源', [
      {
        text: '拍照',
        onPress: async () => {
          const perm = await ImagePicker.requestCameraPermissionsAsync();
          if (!perm.granted) return;
          const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
          if (!result.canceled && result.assets[0]) {
            const compressed = await compressPhoto(result.assets[0].uri);
            setPhoto({ uri: compressed.uri });
          }
        },
      },
      {
        text: '从相册选择',
        onPress: async () => {
          const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!perm.granted) return;
          const result = await ImagePicker.launchImageLibraryAsync({
            quality: 0.8,
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
          });
          if (!result.canceled && result.assets[0]) {
            const compressed = await compressPhoto(result.assets[0].uri);
            setPhoto({ uri: compressed.uri });
          }
        },
      },
      { text: '取消', style: 'cancel' },
    ]);
  };

  const generateAI = async () => {
    if (!summaryInput.trim()) {
      Alert.alert('请先输入违规概况');
      return;
    }
    setGeneratingAI(true);
    try {
      const { data } = await api.post('fines/generate-description', {
        input: summaryInput,
        project_name: form.project_name,
        team_name: form.team_name,
        location: form.location,
        discovery_date: form.discovery_date,
        penalty_type: form.penalty_type,
      });
      setForm((cur) => ({ ...cur, description: data.description || '' }));
    } catch (err: any) {
      Alert.alert('AI 描述生成失败', err.response?.data?.detail || '请稍后重试');
    } finally {
      setGeneratingAI(false);
    }
  };

  const createFine = async () => {
    if (!form.project_name || !form.team_name || !form.location || !form.amount || !form.description) {
      Alert.alert('请填写完整', '项目名称、班组、部位、金额和描述为必填项');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      const data = new FormData();
      Object.entries(form).forEach(([key, value]) => {
        if (value !== '') data.append(key, value as string);
      });
      if (photo?.uri) {
        data.append('photos', {
          uri: photo.uri,
          name: 'fine.jpg',
          type: 'image/jpeg',
        } as any);
      }
      await api.post('fines', data, { headers: { 'Content-Type': 'multipart/form-data' } });
      setActiveTab('history');
      setForm((cur) => ({ ...defaultForm, area_id: cur.area_id, project_name: cur.project_name }));
      setSummaryInput('');
      setPhoto(null);
      await loadData();
    } catch (err: any) {
      setMessage(err.response?.data?.detail || '罚单创建失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[styles.page, { backgroundColor: colors.bg }]}>
      <View style={[styles.tabRow, { backgroundColor: colors.cardSoft, borderColor: colors.border }]}>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'create' && { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => { setActiveTab('create'); setMessage(''); }}
        >
          <Text style={[styles.tabText, { color: activeTab === 'create' ? colors.primary : colors.subtext }]}>新建罚单</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'history' && { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => { setActiveTab('history'); setMessage(''); }}
        >
          <Text style={[styles.tabText, { color: activeTab === 'history' ? colors.primary : colors.subtext }]}>历史记录</Text>
        </TouchableOpacity>
      </View>

      {message ? (
        <Text style={[styles.message, { color: colors.danger, marginTop: 10 }]}>{message}</Text>
      ) : null}

      {activeTab === 'history' ? (
        loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 30 }} />
        ) : (
          <FlatList
            data={items}
            keyExtractor={(item) => String(item.id)}
            onRefresh={loadData}
            refreshing={loading}
            contentContainerStyle={{ paddingBottom: 24, paddingTop: 10 }}
            ListEmptyComponent={
              <Text style={[styles.empty, { color: colors.subtext }]}>暂无罚单记录</Text>
            }
            renderItem={({ item }) => (
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: '#6fbfb1' }]}>
                <View style={[styles.cardAccent, { backgroundColor: item.ticket_type === 'safety' ? colors.primary : colors.amber }]} />
                <View style={styles.rowBetween}>
                  <Text style={[styles.number, { color: colors.text }]}>{item.number}</Text>
                  <Text style={[styles.amount, { color: colors.danger }]}>¥{item.amount}</Text>
                </View>
                <Text style={[styles.meta, { color: colors.subtext }]}>
                  类型：{item.ticket_type === 'safety' ? '安全罚单' : '质量罚单'}
                </Text>
                <Text style={[styles.meta, { color: colors.subtext }]}>班组：{item.team_name || '-'}</Text>
                <Text style={[styles.meta, { color: colors.subtext }]}>部位：{item.location || '-'}</Text>
                <Text style={[styles.desc, { color: colors.text }]} numberOfLines={4}>
                  {item.description || '暂无描述'}
                </Text>
              </View>
            )}
          />
        )
      ) : (
        <View style={{ flex: 1 }}>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 40, paddingTop: 10 }}>
            <View style={[styles.createCard, { backgroundColor: colors.card, borderColor: '#6fbfb1' }]}>
              <View style={[styles.cardAccent, { backgroundColor: colors.primary }]} />
              {/* 罚单类型 */}
              <Text style={[styles.fieldLabel, { color: colors.text, marginTop: 0 }]}>罚单类型</Text>
              <View style={styles.typeRow}>
                {(['safety', 'quality'] as const).map((type) => (
                  <TouchableOpacity
                    key={type}
                    style={[
                      styles.typeButton,
                      {
                        borderColor: form.penalty_type === type ? colors.primary : colors.border,
                        backgroundColor:
                          form.penalty_type === type ? colors.primarySoft : colors.cardSoft,
                      },
                    ]}
                    onPress={() => setForm({ ...form, penalty_type: type })}
                  >
                    <Text
                      style={{
                        color: form.penalty_type === type ? colors.primary : colors.text,
                        fontWeight: '900',
                      }}
                    >
                      {type === 'safety' ? '安全罚单' : '质量罚单'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* 区域选择 */}
              {areas.length > 0 && (
                <>
                  <Text style={[styles.fieldLabel, { color: colors.text }]}>所属区域</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.chipScroll}
                    contentContainerStyle={styles.chipRow}
                  >
                    {areas.map((area) => (
                      <TouchableOpacity
                        key={area.id}
                        style={[
                          styles.chip,
                          {
                            borderColor:
                              form.area_id === String(area.id) ? colors.primary : colors.border,
                            backgroundColor:
                              form.area_id === String(area.id) ? colors.primarySoft : colors.cardSoft,
                          },
                        ]}
                        onPress={() => setForm({ ...form, area_id: String(area.id) })}
                      >
                        <Text
                          style={{
                            color:
                              form.area_id === String(area.id) ? colors.primary : colors.text,
                            fontSize: 12,
                            fontWeight: '800',
                          }}
                        >
                          {area.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </>
              )}

              {/* 基础信息 */}
              <Text style={[styles.fieldLabel, { color: colors.text }]}>项目名称</Text>
              <TextInput
                style={[styles.input, { color: colors.text, borderColor: colors.border }]}
                placeholder="输入项目名称"
                placeholderTextColor={colors.subtext}
                value={form.project_name}
                onChangeText={(v) => setForm({ ...form, project_name: v })}
              />

              <Text style={[styles.fieldLabel, { color: colors.text }]}>受罚班组 / 责任人</Text>
              <TextInput
                style={[styles.input, { color: colors.text, borderColor: colors.border }]}
                placeholder="例如：木工班组 / 张三"
                placeholderTextColor={colors.subtext}
                value={form.team_name}
                onChangeText={(v) => setForm({ ...form, team_name: v })}
              />

              <Text style={[styles.fieldLabel, { color: colors.text }]}>违规部位</Text>
              <TextInput
                style={[styles.input, { color: colors.text, borderColor: colors.border }]}
                placeholder="例如：2号楼8层东侧"
                placeholderTextColor={colors.subtext}
                value={form.location}
                onChangeText={(v) => setForm({ ...form, location: v })}
              />

              {/* 金额快选 */}
              <Text style={[styles.fieldLabel, { color: colors.text }]}>罚款金额</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.amountRow}
              >
                {amountChoices.map((amt) => (
                  <TouchableOpacity
                    key={amt}
                    style={[
                      styles.amountChip,
                      {
                        borderColor:
                          String(amt) === form.amount ? colors.primary : colors.border,
                        backgroundColor:
                          String(amt) === form.amount ? colors.primarySoft : colors.cardSoft,
                      },
                    ]}
                    onPress={() => setForm({ ...form, amount: String(amt) })}
                  >
                    <Text
                      style={{
                        color: String(amt) === form.amount ? colors.primary : colors.text,
                        fontWeight: '800',
                        fontSize: 13,
                      }}
                    >
                      ¥{amt}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <TextInput
                style={[styles.input, { color: colors.text, borderColor: colors.border, marginTop: 8 }]}
                placeholder="或手动输入金额"
                placeholderTextColor={colors.subtext}
                value={form.amount}
                onChangeText={(v) => setForm({ ...form, amount: v })}
                keyboardType="numeric"
              />

              {/* AI 描述 */}
              <View style={[styles.aiBox, { backgroundColor: colors.cardSoft, borderColor: colors.border }]}>
                <View style={styles.aiHeader}>
                  <Sparkles size={15} color={colors.primary} />
                  <Text style={[styles.fieldLabel, { color: colors.text, marginBottom: 0, marginTop: 0 }]}>
                    违规概况（AI 生成描述）
                  </Text>
                </View>
                <TextInput
                  style={[styles.textarea, { color: colors.text, borderColor: colors.border }]}
                  placeholder="先写一段概况，例如：木工班组人员未按要求佩戴安全带…"
                  placeholderTextColor={colors.subtext}
                  value={summaryInput}
                  onChangeText={setSummaryInput}
                  multiline
                  textAlignVertical="top"
                />
                <TouchableOpacity
                  style={[
                    styles.aiButton,
                    { backgroundColor: colors.primary, opacity: generatingAI ? 0.65 : 1 },
                  ]}
                  onPress={generateAI}
                  disabled={generatingAI}
                >
                  {generatingAI ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Sparkles size={14} color="#fff" />
                  )}
                  <Text style={styles.aiButtonText}>
                    {generatingAI ? '生成中...' : 'AI 生成正式描述'}
                  </Text>
                </TouchableOpacity>
              </View>

              <Text style={[styles.fieldLabel, { color: colors.text }]}>正式描述</Text>
              <TextInput
                style={[styles.textarea, { color: colors.text, borderColor: colors.border, minHeight: 120 }]}
                placeholder="AI 生成后出现在这里，也可直接手动填写"
                placeholderTextColor={colors.subtext}
                value={form.description}
                onChangeText={(v) => setForm({ ...form, description: v })}
                multiline
                textAlignVertical="top"
              />

              {/* 照片 */}
              <Text style={[styles.fieldLabel, { color: colors.text }]}>现场照片（可选）</Text>
              {photo ? (
                <View style={styles.photoPreviewWrap}>
                  <Image source={{ uri: photo.uri }} style={styles.photoPreview} />
                  <TouchableOpacity style={styles.photoRemove} onPress={() => setPhoto(null)}>
                    <X size={14} color="#fff" />
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={[styles.photoAdd, { borderColor: colors.border, backgroundColor: colors.cardSoft }]}
                  onPress={openPhotoMenu}
                >
                  <Camera size={22} color={colors.subtext} />
                  <Text style={[styles.photoAddText, { color: colors.subtext }]}>拍照或从相册选择</Text>
                </TouchableOpacity>
              )}

              {message ? (
                <Text style={[styles.message, { color: colors.danger, marginTop: 10 }]}>{message}</Text>
              ) : null}

              {/* 提交 */}
              <TouchableOpacity
                style={[styles.createButton, { backgroundColor: colors.primary, opacity: saving ? 0.65 : 1, marginTop: 16 }]}
                onPress={createFine}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.createText}>提交罚单</Text>
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 16 },
  notice: { borderWidth: 1, borderRadius: 20, padding: 16, marginBottom: 14 },
  noticeTitle: { fontSize: 20, fontWeight: '900' },
  noticeText: { marginTop: 8, lineHeight: 20, fontSize: 13 },
  tabRow: { flexDirection: 'row', borderWidth: 1, borderRadius: 16, padding: 4, marginBottom: 14 },
  tabButton: { flex: 1, borderRadius: 12, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: 'transparent' },
  tabText: { fontWeight: '900', fontSize: 14 },
  message: { marginBottom: 10, fontWeight: '800' },
  createButton: { borderRadius: 16, padding: 15, alignItems: 'center', marginBottom: 14 },
  createText: { color: '#fff', fontWeight: '900', fontSize: 15 },
  createCard: { borderWidth: 1.5, borderRadius: 22, padding: 16, marginBottom: 20, overflow: 'hidden', shadowColor: '#0f766e', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.16, shadowRadius: 16, elevation: 6 },
  card: { borderWidth: 1.5, borderRadius: 20, padding: 14, marginBottom: 14, overflow: 'hidden', shadowColor: '#0f766e', shadowOffset: { width: 0, height: 7 }, shadowOpacity: 0.14, shadowRadius: 14, elevation: 5 },
  cardAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 5 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  number: { fontSize: 16, fontWeight: '900' },
  amount: { fontWeight: '900' },
  meta: { marginTop: 6, fontSize: 12 },
  desc: { marginTop: 10, lineHeight: 20 },
  empty: { marginTop: 34, textAlign: 'center' },
  // Modal
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15,23,42,0.5)' },
  modalCard: { borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, maxHeight: '92%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 20, fontWeight: '900' },
  fieldLabel: { fontSize: 13, fontWeight: '900', marginBottom: 8, marginTop: 14 },
  typeRow: { flexDirection: 'row', gap: 10 },
  typeButton: { flex: 1, borderWidth: 1.2, borderRadius: 14, padding: 12, alignItems: 'center' },
  chipScroll: { marginBottom: 4 },
  chipRow: { gap: 8, paddingRight: 8 },
  chip: { borderWidth: 1.2, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  input: { borderWidth: 1.2, borderRadius: 14, padding: 12, fontSize: 14 },
  amountRow: { gap: 8, paddingRight: 8 },
  amountChip: { borderWidth: 1.2, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
  aiBox: { borderWidth: 1.2, borderRadius: 18, padding: 14, marginTop: 14 },
  aiHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  textarea: { borderWidth: 1.2, borderRadius: 14, padding: 12, minHeight: 80, fontSize: 14 },
  aiButton: { borderRadius: 14, padding: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 10 },
  aiButtonText: { color: '#fff', fontWeight: '900', fontSize: 13 },
  photoPreviewWrap: { position: 'relative', alignSelf: 'flex-start' },
  photoPreview: { width: 120, height: 120, borderRadius: 14 },
  photoRemove: { position: 'absolute', top: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 999, padding: 4 },
  photoAdd: { height: 100, borderWidth: 1.4, borderStyle: 'dashed', borderRadius: 14, alignItems: 'center', justifyContent: 'center', gap: 8 },
  photoAddText: { fontSize: 13, fontWeight: '700' },
});
