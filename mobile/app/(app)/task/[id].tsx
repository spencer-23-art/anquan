import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Camera, CheckCircle2, ChevronLeft, ShieldAlert } from 'lucide-react-native';
import api, { protectedFileUrl } from '../../../src/services/api';

const MAX_PHOTO_BYTES = 200 * 1024;

function severityMeta(severity?: string) {
  if (severity === 'high') return { label: '高风险', color: '#dc2626', bg: '#fee2e2' };
  if (severity === 'medium') return { label: '中风险', color: '#d97706', bg: '#fef3c7' };
  return { label: '低风险', color: '#059669', bg: '#d1fae5' };
}

function textOrFallback(value: unknown, fallback: string) {
  const text = String(value || '').trim();
  return text || fallback;
}

async function getFileSize(uri: string) {
  const response = await fetch(uri);
  const blob = await response.blob();
  return blob.size;
}

async function compressPhoto(uri: string) {
  const widths = [1080, 900, 720, 600, 480, 360];
  const qualities = [0.62, 0.5, 0.4, 0.32, 0.24, 0.18];
  let best: any = null;
  let bestSize = Number.MAX_SAFE_INTEGER;

  for (const width of widths) {
    for (const compress of qualities) {
      const result = await manipulateAsync(uri, [{ resize: { width } }], { compress, format: SaveFormat.JPEG });
      const size = await getFileSize(result.uri);
      if (size < bestSize) {
        best = result;
        bestSize = size;
      }
      if (size <= MAX_PHOTO_BYTES) {
        return { ...result, size };
      }
    }
  }

  if (best && bestSize <= MAX_PHOTO_BYTES) {
    return { ...best, size: bestSize };
  }
  throw new Error(`照片压缩后仍超过 200KB，请稍微离远一点重拍。当前约 ${Math.ceil(bestSize / 1024)}KB`);
}

export default function ChecklistScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [task, setTask] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [cameraActive, setCameraActive] = useState(false);
  const [activeItemId, setActiveItemId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const cameraRef = useRef<any>(null);

  const loadTask = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`tasks/${id}`);
      setTask(res.data);
      setItems(res.data.checklist_items || []);
    } catch (err: any) {
      Alert.alert('加载失败', err.response?.data?.detail || '任务详情加载失败');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadTask();
  }, [loadTask]);

  const openCamera = async (itemId: number) => {
    let currentPermission = permission;
    if (!currentPermission?.granted) {
      currentPermission = await requestPermission();
    }
    if (!currentPermission?.granted) {
      Alert.alert('需要相机权限', '安全排查必须现场拍照，不能从相册选择。请允许相机权限后再拍照。');
      return;
    }
    setActiveItemId(itemId);
    setCameraActive(true);
  };

  const takePicture = async () => {
    if (!cameraRef.current || !activeItemId || uploading) return;
    setUploading(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.8, skipProcessing: false });
      if (!photo?.uri) {
        throw new Error('没有获取到照片，请重新拍摄');
      }
      const compressedImage = await compressPhoto(photo.uri);
      const formData = new FormData();
      formData.append('note', `移动端现场拍照，压缩后约 ${Math.ceil(compressedImage.size / 1024)}KB`);
      formData.append('photo', {
        uri: compressedImage.uri,
        name: `check_${activeItemId}.jpg`,
        type: 'image/jpeg',
      } as any);

      await api.post(`tasks/${id}/items/${activeItemId}/check`, formData);
      setCameraActive(false);
      setActiveItemId(null);
      await loadTask();
    } catch (err: any) {
      Alert.alert('拍照上传失败', err.message || err.response?.data?.detail || '请检查相机权限和网络连接后重试');
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#0f766e" />
        <Text style={styles.centerText}>正在加载任务详情...</Text>
      </View>
    );
  }

  if (cameraActive) {
    return (
      <View style={styles.cameraPage}>
        <CameraView style={styles.camera} facing="back" ref={cameraRef}>
          <View style={styles.cameraOverlay}>
            <View style={styles.cameraTop}>
              <Text style={styles.cameraAlert}>现场实时拍照，禁止相册上传</Text>
              {Platform.OS === 'web' ? <Text style={styles.cameraTip}>Web 端需要浏览器允许相机权限，公网建议使用 HTTPS。</Text> : null}
            </View>
            <TouchableOpacity style={[styles.captureButton, uploading && styles.disabledButton]} onPress={takePicture} disabled={uploading}>
              {uploading ? <ActivityIndicator color="#0f172a" /> : <View style={styles.captureInner} />}
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelButton} onPress={() => setCameraActive(false)} disabled={uploading}>
              <Text style={styles.cancelText}>取消</Text>
            </TouchableOpacity>
          </View>
        </CameraView>
      </View>
    );
  }

  const checkedCount = items.filter((item) => item.status === 'checked').length;
  const isAllChecked = items.length > 0 && checkedCount === items.length;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
        <ChevronLeft size={18} color="#0f172a" />
        <Text style={styles.backText}>返回任务列表</Text>
      </TouchableOpacity>

      <View style={styles.header}>
        <View style={styles.headerIcon}>
          <ShieldAlert color="#0f766e" size={26} />
        </View>
        <Text style={styles.title}>{task?.title || '安全排查任务'}</Text>
        <Text style={styles.desc}>{textOrFallback(task?.description, '管理员下发的现场风险排查任务，请逐项拍照确认。')}</Text>
        <View style={styles.badgeRow}>
          <Text style={styles.areaBadge}>区域：{task?.area?.name || '-'}</Text>
          <Text style={styles.statusBadge}>{task?.status === 'completed' ? '已完成' : `待完成 ${items.length - checkedCount} 项`}</Text>
        </View>
      </View>

      <View style={styles.progressCard}>
        <Text style={styles.progressTitle}>巡查进度</Text>
        <Text style={styles.progressText}>{checkedCount}/{items.length} 项已完成。每一项必须现场拍照，照片会在上传前压缩到 200KB 以内。</Text>
      </View>

      {items.map((item, idx) => {
        const severity = severityMeta(item.severity);
        const photoUri = item.photo_url ? protectedFileUrl(item.photo_url) : '';
        return (
          <View key={item.id} style={styles.checkCard}>
            <View style={styles.checkHeader}>
              <View style={styles.indexPill}>
                <Text style={styles.indexText}>{idx + 1}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.titleRow}>
                  <Text style={styles.cardTitle}>风险详情</Text>
                  <Text style={[styles.severity, { color: severity.color, backgroundColor: severity.bg }]}>{severity.label}</Text>
                </View>
                <Text style={styles.riskText}>{textOrFallback(item.risk_description, '待确认风险')}</Text>
              </View>
            </View>

            <View style={styles.guidanceBox}>
              <Text style={styles.guidanceTitle}>如何排查</Text>
              <Text style={styles.guidanceText}>{textOrFallback(item.inspection_points, '按后台下发的风险要求，对人员、设备、环境和防护措施逐项核查，确认无异常。')}</Text>
            </View>

            <View style={[styles.guidanceBox, styles.photoBox]}>
              <Text style={styles.guidanceTitle}>必须拍什么照片</Text>
              <Text style={styles.guidanceText}>{textOrFallback(item.photo_requirements, '拍摄风险点全景、关键防护措施和整改后状态，确保照片能证明现场已经排查。')}</Text>
            </View>

            <View style={[styles.guidanceBox, styles.measureBox]}>
              <Text style={styles.guidanceTitle}>发现问题怎么处理</Text>
              <Text style={styles.guidanceText}>{textOrFallback(item.measure, '发现问题立即停止相关作业，通知责任人整改，复查合格后再允许继续施工。')}</Text>
            </View>

            <View style={styles.actionRow}>
              <TouchableOpacity style={styles.photoButton} onPress={() => openCamera(item.id)}>
                {photoUri ? (
                  <Image source={{ uri: photoUri }} style={styles.photoPreview} />
                ) : (
                  <View style={styles.photoPlaceholder}>
                    <Camera size={24} color="#0f766e" />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.photoButtonTitle}>{photoUri ? '重新现场拍照' : '现场拍照确认'}</Text>
                  <Text style={styles.photoButtonSub}>只能打开相机，不能从相册选择</Text>
                </View>
              </TouchableOpacity>
              <View style={[styles.checkStatus, item.status === 'checked' ? styles.checkedStatus : styles.pendingStatus]}>
                <CheckCircle2 size={14} color={item.status === 'checked' ? '#059669' : '#94a3b8'} />
                <Text style={[styles.checkStatusText, { color: item.status === 'checked' ? '#059669' : '#64748b' }]}>{item.status === 'checked' ? '已拍照' : '待拍照'}</Text>
              </View>
            </View>
          </View>
        );
      })}

      <TouchableOpacity
        style={[styles.submitBtn, !isAllChecked && styles.disabledButton]}
        onPress={() => {
          if (!isAllChecked) {
            Alert.alert('还不能归档', '请先完成所有项目的现场拍照。');
            return;
          }
          Alert.alert('任务完成', '巡查任务已全部完成并归档。', [{ text: '返回', onPress: () => router.back() }]);
        }}
      >
        <Text style={styles.submitBtnText}>确认提交任务归档</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f8fafc', padding: 20 },
  centerText: { marginTop: 12, color: '#64748b', fontWeight: '700' },
  container: { flex: 1, backgroundColor: '#eef4f2' },
  content: { padding: 16, paddingBottom: 38 },
  backButton: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 12 },
  backText: { color: '#0f172a', fontWeight: '800' },
  header: { borderWidth: 1, borderColor: '#dbe8e4', backgroundColor: '#ffffff', padding: 18, borderRadius: 24, marginBottom: 14 },
  headerIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: '#d9f7ee', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  title: { fontSize: 23, fontWeight: '900', color: '#0f172a', lineHeight: 30 },
  desc: { fontSize: 14, color: '#475569', marginTop: 8, lineHeight: 21 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  areaBadge: { backgroundColor: '#e2e8f0', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, fontSize: 12, color: '#334155', fontWeight: '800' },
  statusBadge: { backgroundColor: '#ccfbf1', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, fontSize: 12, color: '#0f766e', fontWeight: '900' },
  progressCard: { borderRadius: 18, backgroundColor: '#0f766e', padding: 14, marginBottom: 14 },
  progressTitle: { color: '#ffffff', fontSize: 16, fontWeight: '900' },
  progressText: { color: '#d9fffb', marginTop: 4, fontSize: 13, lineHeight: 20 },
  checkCard: { backgroundColor: '#ffffff', padding: 16, borderRadius: 22, marginBottom: 14, borderWidth: 1, borderColor: '#dbe8e4' },
  checkHeader: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  indexPill: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#0f766e', alignItems: 'center', justifyContent: 'center' },
  indexText: { color: '#ffffff', fontWeight: '900' },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 },
  cardTitle: { color: '#0f172a', fontWeight: '900', fontSize: 15 },
  riskText: { fontSize: 15, color: '#0f172a', lineHeight: 22, fontWeight: '700' },
  severity: { overflow: 'hidden', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, fontSize: 12, fontWeight: '900' },
  guidanceBox: { backgroundColor: '#f1f5f9', borderRadius: 16, padding: 12, marginTop: 10 },
  photoBox: { backgroundColor: '#ecfeff' },
  measureBox: { backgroundColor: '#fff7ed' },
  guidanceTitle: { color: '#0f172a', fontWeight: '900', marginBottom: 5, fontSize: 13 },
  guidanceText: { color: '#334155', fontSize: 13, lineHeight: 20 },
  actionRow: { marginTop: 12, gap: 10 },
  photoButton: { borderWidth: 1, borderColor: '#b7d8d0', backgroundColor: '#f8fffd', padding: 10, borderRadius: 16, flexDirection: 'row', alignItems: 'center', gap: 10 },
  photoPlaceholder: { width: 74, height: 58, borderRadius: 12, backgroundColor: '#ccfbf1', alignItems: 'center', justifyContent: 'center' },
  photoPreview: { width: 74, height: 58, borderRadius: 12, backgroundColor: '#e2e8f0' },
  photoButtonTitle: { color: '#0f172a', fontWeight: '900', fontSize: 14 },
  photoButtonSub: { color: '#64748b', marginTop: 3, fontSize: 12 },
  checkStatus: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  checkedStatus: { backgroundColor: '#dcfce7' },
  pendingStatus: { backgroundColor: '#f1f5f9' },
  checkStatusText: { fontSize: 12, fontWeight: '900' },
  submitBtn: { backgroundColor: '#0f766e', padding: 16, borderRadius: 18, alignItems: 'center', marginTop: 8 },
  submitBtnText: { color: '#ffffff', fontSize: 16, fontWeight: '900' },
  disabledButton: { opacity: 0.55 },
  cameraPage: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },
  cameraOverlay: { flex: 1, justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 44, paddingHorizontal: 18 },
  cameraTop: { position: 'absolute', top: 52, left: 18, right: 18, alignItems: 'center' },
  cameraAlert: { color: '#ffffff', fontWeight: '900', fontSize: 17, backgroundColor: 'rgba(15,23,42,0.72)', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, overflow: 'hidden' },
  cameraTip: { marginTop: 8, color: '#fef3c7', fontSize: 12, textAlign: 'center', backgroundColor: 'rgba(15,23,42,0.62)', padding: 8, borderRadius: 10 },
  captureButton: { width: 82, height: 82, borderRadius: 41, backgroundColor: 'rgba(255,255,255,0.38)', justifyContent: 'center', alignItems: 'center', borderWidth: 4, borderColor: '#fff' },
  captureInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#fff' },
  cancelButton: { marginTop: 18, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 999, backgroundColor: 'rgba(15,23,42,0.72)' },
  cancelText: { color: '#fff', fontWeight: '900' },
});
