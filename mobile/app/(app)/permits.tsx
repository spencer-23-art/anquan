import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Dimensions, FlatList, Image, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { Camera, RefreshCcw, Upload } from 'lucide-react-native';
import api from '../../src/services/api';
import { useAuthStore } from '../../src/stores/auth';
import { useAppTheme } from '../../src/hooks/useAppTheme';
import { protectedFileUrl } from '../../src/services/api';

const PERMIT_LABELS: Record<string, string> = {
  hot_work_level1: '动火一级票',
  hot_work_level2: '动火二级票',
  hot_work_level3: '普通动火票',
  height_level1: '登高一级票',
  height_level2: '登高二级票',
  height_level3: '登高三级票',
  height_special: '特级登高票',
  confined_space: '受限空间票',
  lifting: '吊装票',
  excavation: '动土票',
  electrical: '临电票',
  other: '其他票证',
};

const PERMIT_OPTIONS = Object.entries(PERMIT_LABELS).map(([value, label]) => ({ value, label }));

async function compressPhoto(uri: string) {
  return manipulateAsync(uri, [{ resize: { width: 900 } }], { compress: 0.45, format: SaveFormat.JPEG });
}

const SCREEN_W = Dimensions.get('window').width;
const CARD_PADDING = 16 * 2 + 16 * 2; // page padding + card padding
const PHOTO_W = SCREEN_W - CARD_PADDING;

export default function PermitsScreen() {
  const { colors } = useAppTheme();
  const user = useAuthStore((state) => state.user);
  const [permission, requestPermission] = useCameraPermissions();
  const [permits, setPermits] = useState<any[]>([]);
  const [areas, setAreas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cameraAction, setCameraAction] = useState<any>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ type: 'hot_work_level3', area_id: '', responsible_person: '', description: '' });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const cameraRef = useRef<any>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [permitRes, areaRes] = await Promise.all([api.get('permits'), api.get('areas', { params: { include_all: true } })]);
      const areaList = areaRes.data || [];
      setPermits(permitRes.data || []);
      setAreas(areaList);
      setForm((current) => ({ ...current, area_id: current.area_id || String(areaList[0]?.id || '') }));
    } catch (err: any) {
      Alert.alert('加载失败', err.response?.data?.detail || '作业许可加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const openCamera = async (action: any) => {
    if (action.type === 'create' && !form.area_id) {
      Alert.alert('请选择区域', '新增作业许可前需要先选择所属区域。');
      return;
    }
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) return;
    }
    setCameraAction(action);
  };

  const createManualPermit = async (photo?: { uri: string }) => {
    const data = new FormData();
    data.append('type', form.type);
    data.append('area_id', form.area_id);
    data.append('responsible_person', form.responsible_person || user?.real_name || user?.username || '现场安全员');
    data.append('description', form.description);
    if (photo?.uri) {
      data.append('photo', { uri: photo.uri, name: 'permit.jpg', type: 'image/jpeg' } as any);
    }
    await api.post('permits/manual', data, { headers: { 'Content-Type': 'multipart/form-data' } });
    setShowCreate(false);
    setForm((current) => ({ ...current, responsible_person: '', description: '' }));
  };

  const createWithoutPhoto = async () => {
    if (!form.area_id || saving) return;
    setSaving(true);
    try {
      await createManualPermit();
      await loadData();
    } catch (err: any) {
      Alert.alert('创建失败', err.response?.data?.detail || '手动创建作业许可失败');
    } finally {
      setSaving(false);
    }
  };

  const uploadPhoto = async () => {
    if (!cameraRef.current || !cameraAction || saving) return;
    setSaving(true);
    try {
      const photo = await cameraRef.current.takePictureAsync();
      const compressed = await compressPhoto(photo.uri);
      const data = new FormData();
      data.append('photo', { uri: compressed.uri, name: 'permit.jpg', type: 'image/jpeg' } as any);

      if (cameraAction.type === 'create') {
        await createManualPermit(compressed);
      } else if (cameraAction.type === 'renew') {
        await api.post(`permits/${cameraAction.permitId}/renew`, data, { headers: { 'Content-Type': 'multipart/form-data' } });
      } else {
        await api.post(`permits/${cameraAction.permitId}/photo`, data, { headers: { 'Content-Type': 'multipart/form-data' } });
      }
      setCameraAction(null);
      await loadData();
    } catch (err: any) {
      Alert.alert('上传失败', err.response?.data?.detail || err.message || '照片上传失败');
    } finally {
      setSaving(false);
    }
  };

  if (cameraAction) {
    return (
      <View style={{ flex: 1 }}>
        <CameraView ref={cameraRef} style={{ flex: 1 }} facing="back">
          <View style={styles.cameraOverlay}>
            <Text style={styles.cameraText}>请现场拍摄许可照片</Text>
            <TouchableOpacity style={[styles.capture, saving && styles.disabled]} onPress={uploadPhoto} disabled={saving}>
              {saving ? <ActivityIndicator color="#0f172a" /> : <View style={styles.captureInner} />}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setCameraAction(null)}><Text style={styles.cancel}>取消</Text></TouchableOpacity>
          </View>
        </CameraView>
      </View>
    );
  }

  const renderPermit = ({ item }: { item: any }) => {
    const canEdit = user?.role === 'admin' || item.applicant_id === user?.id;
    return (
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: item.status === 'warning' ? colors.amber : colors.border }]}>
        <View style={styles.rowBetween}>
          <Text style={[styles.title, { color: colors.text }]}>{PERMIT_LABELS[item.type] || item.type}</Text>
          <Text style={[styles.badge, { color: item.status === 'expired' ? colors.subtext : item.status === 'warning' ? colors.amber : colors.primary }]}>
            {item.status === 'expired' ? '已过期' : item.status === 'warning' ? '即将到期' : '有效中'}
          </Text>
        </View>
        <Text style={[styles.meta, { color: colors.subtext }]}>区域：{item.area?.name || '-'}</Text>
        <Text style={[styles.meta, { color: colors.subtext }]}>上传人：{item.applicant?.real_name || item.applicant?.username || '-'}</Text>
        <Text style={[styles.meta, { color: colors.subtext }]}>责任人：{item.responsible_person || '-'}</Text>
        <Text style={[styles.meta, { color: colors.subtext }]}>有效期：{item.start_time ? new Date(item.start_time).toLocaleString() : '-'} 至 {item.end_time ? new Date(item.end_time).toLocaleString() : '-'}</Text>
        {item.photo_url ? (
          <TouchableOpacity onPress={() => setPreviewUrl(protectedFileUrl(item.photo_url))} activeOpacity={0.85}>
            <Image
              source={{ uri: protectedFileUrl(item.photo_url) }}
              style={styles.permitPhoto}
              resizeMode="cover"
            />
            <Text style={[styles.photoHint, { color: colors.primary }]}>点击查看大图</Text>
          </TouchableOpacity>
        ) : (
          <Text style={[styles.needPhoto, { color: colors.amber }]}>未上传许可照片</Text>
        )}
        {canEdit ? (
          <View style={styles.actionRow}>
            <TouchableOpacity style={[styles.actionBtn, { borderColor: colors.border }]} onPress={() => openCamera({ type: 'photo', permitId: item.id })}>
              <Upload size={16} color={colors.primary} /><Text style={[styles.actionText, { color: colors.text }]}>换照片</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionBtn, { borderColor: colors.border }]} onPress={() => openCamera({ type: 'renew', permitId: item.id })}>
              <RefreshCcw size={16} color={colors.primary} /><Text style={[styles.actionText, { color: colors.text }]}>续票</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <Text style={[styles.readOnlyHint, { color: colors.subtext }]}>仅查看：只能修改自己上传的作业许可</Text>
        )}
      </View>
    );
  };

  return (
    <View style={[styles.page, { backgroundColor: colors.bg }]}>
      <TouchableOpacity style={[styles.createButton, { backgroundColor: colors.primary }]} onPress={() => setShowCreate(true)}>
        <Camera color="#fff" size={18} /><Text style={styles.createText}>手动新增作业许可</Text>
      </TouchableOpacity>
      {loading ? <ActivityIndicator color={colors.primary} style={{ marginTop: 30 }} /> : (
        <FlatList data={permits} keyExtractor={(item) => String(item.id)} renderItem={renderPermit} onRefresh={loadData} refreshing={loading} contentContainerStyle={{ paddingBottom: 30 }} />
      )}

      <Modal visible={showCreate} transparent animationType="slide" onRequestClose={() => setShowCreate(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: colors.card }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>新增作业许可</Text>
            <Text style={[styles.fieldLabel, { color: colors.text }]}>票证类型</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.optionScroll} contentContainerStyle={styles.optionRow}>
              {PERMIT_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.optionChip,
                    { borderColor: form.type === option.value ? colors.primary : colors.border, backgroundColor: form.type === option.value ? colors.primarySoft : colors.card },
                  ]}
                  onPress={() => setForm({ ...form, type: option.value })}
                >
                  <Text style={[styles.optionText, { color: form.type === option.value ? colors.primary : colors.text }]}>{option.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Text style={[styles.fieldLabel, { color: colors.text }]}>所属区域</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.optionScroll} contentContainerStyle={styles.optionRow}>
              {areas.map((area) => (
                <TouchableOpacity
                  key={area.id}
                  style={[
                    styles.optionChip,
                    { borderColor: form.area_id === String(area.id) ? colors.primary : colors.border, backgroundColor: form.area_id === String(area.id) ? colors.primarySoft : colors.card },
                  ]}
                  onPress={() => setForm({ ...form, area_id: String(area.id) })}
                >
                  <Text style={[styles.optionText, { color: form.area_id === String(area.id) ? colors.primary : colors.text }]}>{area.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TextInput style={[styles.input, { color: colors.text, borderColor: colors.border }]} placeholder="责任人" placeholderTextColor={colors.subtext} value={form.responsible_person} onChangeText={(responsible_person) => setForm({ ...form, responsible_person })} />
            <TextInput style={[styles.input, { color: colors.text, borderColor: colors.border }]} placeholder="描述" placeholderTextColor={colors.subtext} value={form.description} onChangeText={(description) => setForm({ ...form, description })} />
            <TouchableOpacity style={[styles.createButton, { backgroundColor: colors.primary }]} onPress={() => openCamera({ type: 'create' })}>
              <Camera color="#fff" size={18} /><Text style={styles.createText}>拍照并创建</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.secondaryButton, { borderColor: colors.border }]} onPress={createWithoutPhoto} disabled={saving || !form.area_id}>
              {saving ? <ActivityIndicator color={colors.primary} /> : <Text style={[styles.secondaryText, { color: colors.text }]}>先创建，稍后补照片</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowCreate(false)}><Text style={[styles.close, { color: colors.subtext }]}>取消</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 照片全屏预览 */}
      <Modal visible={!!previewUrl} transparent animationType="fade" onRequestClose={() => setPreviewUrl(null)}>
        <TouchableOpacity style={styles.previewBackdrop} activeOpacity={1} onPress={() => setPreviewUrl(null)}>
          {previewUrl ? (
            <Image source={{ uri: previewUrl }} style={styles.previewImage} resizeMode="contain" />
          ) : null}
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 16 },
  createButton: { borderRadius: 16, padding: 15, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, marginBottom: 14 },
  createText: { color: '#fff', fontWeight: '900' },
  card: { borderWidth: 1, borderRadius: 20, padding: 16, marginBottom: 12 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  title: { fontSize: 17, fontWeight: '900', flex: 1 },
  badge: { fontWeight: '900' },
  meta: { fontSize: 12, marginTop: 8, lineHeight: 18 },
  photoOk: { marginTop: 10, fontWeight: '800' },
  needPhoto: { marginTop: 10, fontWeight: '800' },
  readOnlyHint: { marginTop: 12, fontSize: 12, fontWeight: '800' },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  actionBtn: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionText: { fontWeight: '800' },
  cameraOverlay: { flex: 1, justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 44, backgroundColor: 'transparent' },
  cameraText: { position: 'absolute', top: 54, color: '#fff', backgroundColor: 'rgba(0,0,0,0.45)', padding: 10, borderRadius: 12, fontWeight: '900' },
  capture: { width: 82, height: 82, borderRadius: 41, backgroundColor: 'rgba(255,255,255,0.35)', alignItems: 'center', justifyContent: 'center' },
  captureInner: { width: 62, height: 62, borderRadius: 31, backgroundColor: '#fff' },
  cancel: { color: '#fff', marginTop: 18, fontWeight: '900' },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15,23,42,0.45)' },
  modalCard: { borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 18 },
  modalTitle: { fontSize: 20, fontWeight: '900', marginBottom: 14 },
  fieldLabel: { fontSize: 13, fontWeight: '900', marginBottom: 8 },
  optionScroll: { marginBottom: 10 },
  optionRow: { gap: 8, paddingRight: 8 },
  optionChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 9 },
  optionText: { fontSize: 12, fontWeight: '900' },
  input: { borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 10 },
  secondaryButton: { borderWidth: 1, borderRadius: 16, padding: 14, alignItems: 'center', marginBottom: 8 },
  secondaryText: { fontWeight: '900' },
  close: { textAlign: 'center', padding: 12, fontWeight: '800' },
  disabled: { opacity: 0.55 },
  permitPhoto: { width: PHOTO_W, height: PHOTO_W * 0.55, borderRadius: 14, marginTop: 12, backgroundColor: '#f1f5f9' },
  photoHint: { marginTop: 4, fontSize: 11, fontWeight: '700', textAlign: 'center' },
  needPhoto: { marginTop: 10, fontWeight: '800' },
  previewBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  previewImage: { width: SCREEN_W, height: SCREEN_W * 1.3 },
});
