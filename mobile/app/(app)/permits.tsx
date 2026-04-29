import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { Camera, RefreshCcw, Upload } from 'lucide-react-native';
import api from '../../src/services/api';
import { useAppTheme } from '../../src/hooks/useAppTheme';

const PERMIT_LABELS: Record<string, string> = {
  hot_work_level1: '动火一级票',
  hot_work_level2: '动火二级票',
  hot_work_level3: '动火三级票',
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

async function compressPhoto(uri: string) {
  return manipulateAsync(uri, [{ resize: { width: 900 } }], { compress: 0.45, format: SaveFormat.JPEG });
}

export default function PermitsScreen() {
  const { colors } = useAppTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [permits, setPermits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [cameraAction, setCameraAction] = useState<any>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ type: 'hot_work_level1', area_id: '', responsible_person: '', description: '' });
  const cameraRef = useRef<any>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [permitRes, areaRes] = await Promise.all([api.get('permits'), api.get('areas')]);
      const areaList = areaRes.data || [];
      setPermits(permitRes.data || []);
      setForm((current) => ({ ...current, area_id: current.area_id || String(areaList[0]?.id || '') }));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const openCamera = async (action: any) => {
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) return;
    }
    setCameraAction(action);
  };

  const uploadPhoto = async () => {
    if (!cameraRef.current || !cameraAction) return;
    const photo = await cameraRef.current.takePictureAsync();
    const compressed = await compressPhoto(photo.uri);
    const data = new FormData();
    data.append('photo', { uri: compressed.uri, name: 'permit.jpg', type: 'image/jpeg' } as any);

    if (cameraAction.type === 'create') {
      data.append('type', form.type);
      data.append('area_id', form.area_id);
      data.append('responsible_person', form.responsible_person || '现场安全员');
      data.append('description', form.description);
      await api.post('permits/manual', data, { headers: { 'Content-Type': 'multipart/form-data' } });
      setShowCreate(false);
      setForm((current) => ({ ...current, responsible_person: '', description: '' }));
    } else if (cameraAction.type === 'renew') {
      await api.post(`permits/${cameraAction.permitId}/renew`, data, { headers: { 'Content-Type': 'multipart/form-data' } });
    } else {
      await api.post(`permits/${cameraAction.permitId}/photo`, data, { headers: { 'Content-Type': 'multipart/form-data' } });
    }
    setCameraAction(null);
    await loadData();
  };

  if (cameraAction) {
    return (
      <View style={{ flex: 1 }}>
        <CameraView ref={cameraRef} style={{ flex: 1 }} facing="back">
          <View style={styles.cameraOverlay}>
            <Text style={styles.cameraText}>请现场拍摄许可照片</Text>
            <TouchableOpacity style={styles.capture} onPress={uploadPhoto}><View style={styles.captureInner} /></TouchableOpacity>
            <TouchableOpacity onPress={() => setCameraAction(null)}><Text style={styles.cancel}>取消</Text></TouchableOpacity>
          </View>
        </CameraView>
      </View>
    );
  }

  const renderPermit = ({ item }: { item: any }) => (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: item.status === 'warning' ? colors.amber : colors.border }]}>
      <View style={styles.rowBetween}>
        <Text style={[styles.title, { color: colors.text }]}>{PERMIT_LABELS[item.type] || item.type}</Text>
        <Text style={[styles.badge, { color: item.status === 'expired' ? colors.subtext : item.status === 'warning' ? colors.amber : colors.primary }]}>
          {item.status === 'expired' ? '已过期' : item.status === 'warning' ? '即将到期' : '有效中'}
        </Text>
      </View>
      <Text style={[styles.meta, { color: colors.subtext }]}>区域：{item.area?.name || '-'}</Text>
      <Text style={[styles.meta, { color: colors.subtext }]}>责任人：{item.responsible_person || '-'}</Text>
      <Text style={[styles.meta, { color: colors.subtext }]}>有效期：{item.start_time ? new Date(item.start_time).toLocaleString() : '-'} 至 {item.end_time ? new Date(item.end_time).toLocaleString() : '-'}</Text>
      {item.photo_url ? <Text style={[styles.photoOk, { color: colors.primary }]}>已上传许可照片</Text> : <Text style={[styles.needPhoto, { color: colors.amber }]}>必须上传许可照片</Text>}
      <View style={styles.actionRow}>
        <TouchableOpacity style={[styles.actionBtn, { borderColor: colors.border }]} onPress={() => openCamera({ type: 'photo', permitId: item.id })}>
          <Upload size={16} color={colors.primary} /><Text style={[styles.actionText, { color: colors.text }]}>换照片</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, { borderColor: colors.border }]} onPress={() => openCamera({ type: 'renew', permitId: item.id })}>
          <RefreshCcw size={16} color={colors.primary} /><Text style={[styles.actionText, { color: colors.text }]}>续票</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={[styles.page, { backgroundColor: colors.bg }]}>
      <TouchableOpacity style={[styles.createButton, { backgroundColor: colors.primary }]} onPress={() => setShowCreate(true)}>
        <Camera color="#fff" size={18} /><Text style={styles.createText}>现场拍照新增作业许可</Text>
      </TouchableOpacity>
      {loading ? <ActivityIndicator color={colors.primary} style={{ marginTop: 30 }} /> : (
        <FlatList data={permits} keyExtractor={(item) => String(item.id)} renderItem={renderPermit} onRefresh={loadData} refreshing={loading} contentContainerStyle={{ paddingBottom: 30 }} />
      )}

      <Modal visible={showCreate} transparent animationType="slide" onRequestClose={() => setShowCreate(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: colors.card }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>新增作业许可</Text>
            <TextInput style={[styles.input, { color: colors.text, borderColor: colors.border }]} placeholder="票证类型：hot_work_level1 / confined_space 等" placeholderTextColor={colors.subtext} value={form.type} onChangeText={(type) => setForm({ ...form, type })} />
            <TextInput style={[styles.input, { color: colors.text, borderColor: colors.border }]} placeholder="区域ID" placeholderTextColor={colors.subtext} value={form.area_id} onChangeText={(area_id) => setForm({ ...form, area_id })} keyboardType="number-pad" />
            <TextInput style={[styles.input, { color: colors.text, borderColor: colors.border }]} placeholder="责任人" placeholderTextColor={colors.subtext} value={form.responsible_person} onChangeText={(responsible_person) => setForm({ ...form, responsible_person })} />
            <TextInput style={[styles.input, { color: colors.text, borderColor: colors.border }]} placeholder="描述" placeholderTextColor={colors.subtext} value={form.description} onChangeText={(description) => setForm({ ...form, description })} />
            <TouchableOpacity style={[styles.createButton, { backgroundColor: colors.primary }]} onPress={() => openCamera({ type: 'create' })}>
              <Camera color="#fff" size={18} /><Text style={styles.createText}>拍照并创建</Text>
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
  createButton: { borderRadius: 16, padding: 15, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, marginBottom: 14 },
  createText: { color: '#fff', fontWeight: '900' },
  card: { borderWidth: 1, borderRadius: 20, padding: 16, marginBottom: 12 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  title: { fontSize: 17, fontWeight: '900', flex: 1 },
  badge: { fontWeight: '900' },
  meta: { fontSize: 12, marginTop: 8, lineHeight: 18 },
  photoOk: { marginTop: 10, fontWeight: '800' },
  needPhoto: { marginTop: 10, fontWeight: '800' },
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
  input: { borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 10 },
  close: { textAlign: 'center', padding: 12, fontWeight: '800' },
});
