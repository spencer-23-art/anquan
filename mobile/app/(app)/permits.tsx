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

const PERMIT_META: Record<string, string> = {
  hot_work_level1: '默认 8 小时',
  hot_work_level2: '默认 3 天',
  hot_work_level3: '默认 7 天',
  height_level1: '默认 7 天',
  height_level2: '默认 7 天',
  height_level3: '默认 7 天',
  height_special: '默认 8 小时',
  confined_space: '默认 12 小时',
  lifting: '默认 7 天',
  excavation: '默认 7 天',
  electrical: '默认 7 天',
  other: '默认 7 天',
};

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

  const getRemainingInfo = (item: any) => {
    if (!item.end_time || item.status === 'expired') return { text: '已过期', ms: -1, pct: 0 };
    const remaining = new Date(item.end_time).getTime() - Date.now();
    if (remaining <= 0) return { text: '已过期', ms: 0, pct: 0 };
    const totalMs = item.start_time ? new Date(item.end_time).getTime() - new Date(item.start_time).getTime() : 1;
    const pct = (remaining / totalMs) * 100;
    const hours = remaining / (1000 * 60 * 60);
    const days = hours / 24;
    let text = '';
    if (days >= 1) text = `剩余 ${Math.floor(days)} 天`;
    else if (hours >= 1) text = `剩余 ${Math.floor(hours)} 小时`;
    else text = `剩余 ${Math.floor(remaining / (1000 * 60))} 分钟`;
    return { text, ms: remaining, pct };
  };

  // 有效期 < 20% 时弹出提醒
  useEffect(() => {
    if (!permits.length) return;
    const urgent = permits.filter((p) => {
      if (p.status === 'expired') return false;
      const info = getRemainingInfo(p);
      return info.pct > 0 && info.pct < 20;
    });
    if (urgent.length > 0) {
      Alert.alert(
        '⚠️ 许可即将到期',
        `你有 ${urgent.length} 张作业许可剩余有效期不足 20%，请及时续期！`,
      );
    }
  }, [permits]);

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

  const sortedPermits = [...permits].sort((a, b) => {
    const ra = getRemainingInfo(a);
    const rb = getRemainingInfo(b);
    if (ra.ms <= 0 && rb.ms > 0) return 1;
    if (rb.ms <= 0 && ra.ms > 0) return -1;
    if (ra.ms <= 0 && rb.ms <= 0) return 0;
    return ra.ms - rb.ms;
  });

  const renderPermit = ({ item }: { item: any }) => {
    const canEdit = user?.role === 'admin' || item.applicant_id === user?.id;
    const remaining = getRemainingInfo(item);
    const isUrgent = remaining.pct > 0 && remaining.pct < 20;
    const isNotExpired = item.status !== 'expired';
    const statusColor = item.status === 'expired' ? colors.subtext : isUrgent ? colors.danger : item.status === 'warning' ? colors.amber : colors.primary;
    const statusBg = item.status === 'expired' ? colors.cardSoft : isUrgent ? `${colors.danger}18` : item.status === 'warning' ? '#fef3c7' : colors.primarySoft;
    const countdownBg = isUrgent ? `${colors.danger}15` : `${colors.amber}15`;

    const borderColor = item.status === 'expired' || remaining.ms <= 0 ? colors.border : isUrgent ? colors.danger : colors.primary;

    return (
      <View style={[styles.card, { backgroundColor: colors.card, borderColor }]}>
        {/* 头部：Permit #ID + 类型 + 状态 */}
        <View style={styles.rowBetween}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.permitId, { color: colors.subtext }]}>Permit #{item.id}</Text>
            <Text style={[styles.title, { color: colors.text }]}>{PERMIT_LABELS[item.type] || item.type}</Text>
            <Text style={[styles.areaLabel, { color: colors.subtext }]}>{item.area?.name || '未分配区域'}</Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusBg }]}>
            <Text style={[styles.statusText, { color: statusColor }]}>
              {item.status === 'expired' ? '已过期' : isUrgent ? '即将到期' : item.status === 'warning' ? '即将到期' : '有效中'}
            </Text>
          </View>
        </View>

        {/* 两列网格：责任人 + 倒计时 */}
        <View style={styles.infoGrid}>
          <View style={[styles.infoCell, { backgroundColor: colors.cardSoft }]}>
            <Text style={[styles.infoLabel, { color: colors.subtext }]}>👤 责任人</Text>
            <Text style={[styles.infoValue, { color: colors.text }]}>{item.responsible_person || '未填写'}</Text>
          </View>
          <View style={[styles.infoCell, { backgroundColor: colors.cardSoft }]}>
            <Text style={[styles.infoLabel, { color: colors.subtext }]}>⏱ 倒计时</Text>
            {isNotExpired ? (
              <View style={[styles.countdownBadge, { backgroundColor: countdownBg }]}>
                <Text style={[styles.countdownText, { color: isUrgent ? colors.danger : colors.amber }]}>{remaining.text}</Text>
              </View>
            ) : (
              <Text style={[styles.infoValue, { color: colors.subtext }]}>已过期</Text>
            )}
          </View>
        </View>

        {/* 两列网格：生效时间 + 到期时间 */}
        <View style={styles.infoGrid}>
          <View style={[styles.infoCell, { backgroundColor: colors.cardSoft }]}>
            <Text style={[styles.infoLabel, { color: colors.subtext }]}>📅 生效时间</Text>
            <Text style={[styles.infoTime, { color: colors.text }]}>{item.start_time ? new Date(item.start_time).toLocaleString() : '-'}</Text>
          </View>
          <View style={[styles.infoCell, { backgroundColor: colors.cardSoft }]}>
            <Text style={[styles.infoLabel, { color: colors.subtext }]}>🛡 到期时间</Text>
            <Text style={[styles.infoTime, { color: colors.text }]}>{item.end_time ? new Date(item.end_time).toLocaleString() : '-'}</Text>
          </View>
        </View>

        {/* 描述 */}
        <View style={[styles.descBox, { backgroundColor: colors.cardSoft }]}>
          <Text style={[styles.infoLabel, { color: colors.subtext }]}>描述</Text>
          <Text style={[styles.descText, { color: colors.text }]} numberOfLines={2}>{item.description || '暂无补充说明'}</Text>
        </View>

        {/* 照片 */}
        {item.photo_url ? (
          <TouchableOpacity onPress={() => setPreviewUrl(protectedFileUrl(item.photo_url))} activeOpacity={0.85}>
            <Image source={{ uri: protectedFileUrl(item.photo_url) }} style={styles.permitPhoto} resizeMode="cover" />
            <Text style={[styles.photoHint, { color: colors.primary }]}>点击查看大图</Text>
          </TouchableOpacity>
        ) : (
          <Text style={[styles.needPhoto, { color: colors.amber }]}>未上传许可照片</Text>
        )}

        {/* 底部操作栏 */}
        <View style={[styles.cardFooter, { borderTopColor: colors.border }]}>
          <Text style={[styles.footerNote, { color: colors.subtext }]}>{PERMIT_META[item.type] || ''}</Text>
          <View style={styles.footerActions}>
            {canEdit && isNotExpired && (
              <TouchableOpacity style={[styles.footerBtn, { backgroundColor: isUrgent ? colors.danger : colors.primary }]} onPress={() => openCamera({ type: 'renew', permitId: item.id })}>
                <RefreshCcw size={13} color="#fff" /><Text style={styles.footerBtnText}>续期</Text>
              </TouchableOpacity>
            )}
            {canEdit && (
              <TouchableOpacity style={[styles.footerBtnOutline, { borderColor: colors.border }]} onPress={() => openCamera({ type: 'photo', permitId: item.id })}>
                <Upload size={13} color={colors.text} /><Text style={[styles.footerBtnOutlineText, { color: colors.text }]}>换照片</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.page, { backgroundColor: colors.bg }]}>
      <TouchableOpacity style={[styles.createButton, { backgroundColor: colors.primary }]} onPress={() => setShowCreate(true)}>
        <Camera color="#fff" size={18} /><Text style={styles.createText}>手动新增作业许可</Text>
      </TouchableOpacity>
      {loading ? <ActivityIndicator color={colors.primary} style={{ marginTop: 30 }} /> : (
        <FlatList data={sortedPermits} keyExtractor={(item) => String(item.id)} renderItem={renderPermit} onRefresh={loadData} refreshing={loading} contentContainerStyle={{ paddingBottom: 30 }} />
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
  // Card
  card: { borderWidth: 1, borderRadius: 20, overflow: 'hidden', marginBottom: 12 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, padding: 16, paddingBottom: 0 },
  permitId: { fontSize: 10, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1.5 },
  title: { fontSize: 16, fontWeight: '900', marginTop: 2 },
  areaLabel: { fontSize: 12, marginTop: 2 },
  statusBadge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  statusText: { fontSize: 11, fontWeight: '700' },
  // Info grids
  infoGrid: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginTop: 10 },
  infoCell: { flex: 1, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10 },
  infoLabel: { fontSize: 11, fontWeight: '600' },
  infoValue: { fontSize: 14, fontWeight: '700', marginTop: 4 },
  infoTime: { fontSize: 11, fontWeight: '600', marginTop: 4 },
  countdownBadge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginTop: 4, alignSelf: 'flex-start' },
  countdownText: { fontSize: 11, fontWeight: '700' },
  // Description
  descBox: { borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, marginHorizontal: 16, marginTop: 10 },
  descText: { fontSize: 12, lineHeight: 18, marginTop: 4 },
  // Photo
  permitPhoto: { width: PHOTO_W, height: PHOTO_W * 0.55, borderRadius: 14, marginTop: 12, marginHorizontal: 16, backgroundColor: '#f1f5f9' },
  photoHint: { marginTop: 4, fontSize: 11, fontWeight: '700', textAlign: 'center' },
  needPhoto: { marginTop: 10, marginHorizontal: 16, fontWeight: '800' },
  // Footer
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, marginTop: 12, paddingHorizontal: 16, paddingVertical: 10 },
  footerNote: { fontSize: 11, flex: 1 },
  footerActions: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  footerBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  footerBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  footerBtnOutline: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  footerBtnOutlineText: { fontSize: 12, fontWeight: '700' },
  // Camera
  cameraOverlay: { flex: 1, justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 44, backgroundColor: 'transparent' },
  cameraText: { position: 'absolute', top: 54, color: '#fff', backgroundColor: 'rgba(0,0,0,0.45)', padding: 10, borderRadius: 12, fontWeight: '900' },
  capture: { width: 82, height: 82, borderRadius: 41, backgroundColor: 'rgba(255,255,255,0.35)', alignItems: 'center', justifyContent: 'center' },
  captureInner: { width: 62, height: 62, borderRadius: 31, backgroundColor: '#fff' },
  cancel: { color: '#fff', marginTop: 18, fontWeight: '900' },
  // Create modal
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
  // Preview
  previewBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  previewImage: { width: SCREEN_W, height: SCREEN_W * 1.3 },
});
