import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Camera, CheckCircle2, ChevronLeft, ShieldAlert } from 'lucide-react-native';
import api, { protectedFileUrl } from '../../../src/services/api';

const MAX_PHOTO_BYTES = 200 * 1024;
const PERMIT_INFO: Record<string, { name: string; level: string }> = {
  hot_work_level1: { name: '动火作业票', level: '一级' },
  hot_work_level2: { name: '动火作业票', level: '二级' },
  hot_work_level3: { name: '动火作业票', level: '普通' },
  height_level1: { name: '高处作业票', level: '一级' },
  height_level2: { name: '高处作业票', level: '二级' },
  height_level3: { name: '高处作业票', level: '三级' },
  height_special: { name: '高处作业票', level: '特级' },
  confined_space: { name: '受限空间作业票', level: '专项' },
  lifting: { name: '吊装作业票', level: '专项' },
  excavation: { name: '动土作业票', level: '专项' },
  electrical: { name: '临时用电作业票', level: '专项' },
  other: { name: '作业票据', level: '专项' },
};

function permitInfo(type?: string) {
  return PERMIT_INFO[String(type || '')] || { name: '作业票据', level: '专项' };
}

function severityMeta(severity?: string) {
  if (severity === 'high') return { label: '高风险', color: '#dc2626', bg: '#fee2e2' };
  if (severity === 'medium') return { label: '中风险', color: '#d97706', bg: '#fef3c7' };
  return { label: '低风险', color: '#059669', bg: '#d1fae5' };
}

function textOrFallback(value: unknown, fallback: string) {
  const text = String(value || '').trim();
  return text || fallback;
}

function statusValue(value: unknown) {
  return String(value || '').toLowerCase();
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
  const [cameraTarget, setCameraTarget] = useState<{ kind: 'check' | 'permit' | 'add_photo'; id?: number; index?: number; responsible_person?: string; description?: string } | null>(null);
  const [permitResponsibleModal, setPermitResponsibleModal] = useState<{ index: number; permit: any } | null>(null);
  const [permitResponsibleName, setPermitResponsibleName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const cameraRef = useRef<any>(null);
  const scrollRef = useRef<ScrollView>(null);
  const scrollOffsetRef = useRef(0);

  const loadTask = useCallback(async (options?: { silent?: boolean; restoreScroll?: boolean }) => {
    if (!options?.silent) {
      setLoading(true);
    }
    try {
      const res = await api.get(`tasks/${id}`);
      setTask(res.data);
      setItems(res.data.checklist_items || []);
      if (options?.restoreScroll) {
        const targetOffset = scrollOffsetRef.current;
        requestAnimationFrame(() => {
          scrollRef.current?.scrollTo({ y: targetOffset, animated: false });
        });
        setTimeout(() => {
          scrollRef.current?.scrollTo({ y: targetOffset, animated: false });
        }, 80);
      }
    } catch (err: any) {
      Alert.alert('加载失败', err.response?.data?.detail || '任务详情加载失败');
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }, [id]);

  useEffect(() => {
    loadTask();
  }, [loadTask]);

  const openCamera = async (target: { kind: 'check' | 'permit' | 'add_photo'; id?: number; index?: number; responsible_person?: string; description?: string }) => {
    let currentPermission = permission;
    if (!currentPermission?.granted) {
      currentPermission = await requestPermission();
    }
    if (!currentPermission?.granted) {
      Alert.alert('需要相机权限', '安全排查必须现场拍照，不能从相册选择。请允许相机权限后再拍照。');
      return;
    }
    setCameraTarget(target);
    setCameraActive(true);
  };

  const openPermitResponsible = (index: number, permit: any) => {
    setPermitResponsibleModal({ index, permit });
    setPermitResponsibleName(String(permit?.responsible_person || '').trim());
  };

  const confirmPermitResponsible = async () => {
    if (!permitResponsibleModal) return;
    const name = permitResponsibleName.trim();
    if (!name) {
      Alert.alert('请填写负责人', '作业票据拍照办理前，需要填写现场负责人。');
      return;
    }
    const { index, permit } = permitResponsibleModal;
    setPermitResponsibleModal(null);
    await openCamera({
      kind: 'permit',
      index,
      responsible_person: name,
      description: permit?.description || permit?.reason || '',
    });
  };

  const takePicture = async () => {
    if (!cameraRef.current || !cameraTarget || uploading) return;
    setUploading(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.8, skipProcessing: false });
      if (!photo?.uri) {
        throw new Error('没有获取到照片，请重新拍摄');
      }
      const compressedImage = await compressPhoto(photo.uri);
      const formData = new FormData();
      formData.append('photo', {
        uri: compressedImage.uri,
        name: `${cameraTarget.kind}_${cameraTarget.id ?? cameraTarget.index}.jpg`,
        type: 'image/jpeg',
      } as any);

      if (cameraTarget.kind === 'check') {
        formData.append('note', `移动端现场拍照，压缩后约 ${Math.ceil(compressedImage.size / 1024)}KB`);
        await api.post(`tasks/${id}/items/${cameraTarget.id}/check`, formData);
      } else if (cameraTarget.kind === 'add_photo') {
        await api.post(`tasks/${id}/items/${cameraTarget.id}/add-photo`, formData);
      } else {
        formData.append('responsible_person', cameraTarget.responsible_person || '');
        formData.append('description', cameraTarget.description || '');
        await api.post(`tasks/${id}/permits/${cameraTarget.index}/photo`, formData);
      }
      setCameraActive(false);
      setCameraTarget(null);
      await loadTask({ silent: true, restoreScroll: true });
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

  const checkedCount = items.filter((item) => statusValue(item.status) === 'checked').length;
  const requiredPermits = task?.required_permits || [];
  const completedPermitCount = requiredPermits.filter((permit: any) => permit.permit_id && permit.photo_url).length;
  const isAllChecked = items.length > 0 && checkedCount === items.length && completedPermitCount === requiredPermits.length;
  const taskContextBadges = [
    task?.project_name ? `项目：${task.project_name}` : '',
    task?.area?.name ? `区域：${task.area.name}` : '',
    task?.work_point ? `作业点：${task.work_point}` : '',
    task?.process_name ? `工序：${task.process_name}` : '',
  ].filter(Boolean);

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.container}
      contentContainerStyle={styles.content}
      scrollEventThrottle={16}
      onScroll={(event) => {
        scrollOffsetRef.current = event.nativeEvent.contentOffset.y;
      }}
    >
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
          {taskContextBadges.map((badge) => (
            <Text key={badge} style={styles.areaBadge}>{badge}</Text>
          ))}
          <Text style={styles.statusBadge}>{statusValue(task?.status) === 'completed' ? '已完成' : `待完成 ${items.length - checkedCount} 项`}</Text>
        </View>
      </View>

      <View style={styles.progressCard}>
        <Text style={styles.progressTitle}>巡查进度</Text>
        <Text style={styles.progressText}>{checkedCount}/{items.length} 项已完成，作业许可 {completedPermitCount}/{requiredPermits.length} 张已拍照办理。所有照片上传前都会压缩到 200KB 以内。</Text>
      </View>

      {requiredPermits.length ? (
        <View style={styles.permitSection}>
          <Text style={styles.sectionTitle}>必须办理的作业许可</Text>
          <Text style={styles.sectionHint}>这些票证只有你现场拍照上传后，才会同步到后台作业许可。</Text>
          {requiredPermits.map((permit: any, index: number) => {
            const info = permitInfo(permit.type);
            const permitText = String(permit.description || permit.reason || '').trim();
            return (
            <View key={`${permit.type}-${index}`} style={styles.permitCard}>
              <View style={{ flex: 1 }}>
                <View style={styles.permitTitleRow}>
                  <Text style={styles.permitTitle}>{info.name}</Text>
                  <Text style={styles.permitLevel}>{info.level}</Text>
                </View>
                {permitText ? <Text style={styles.permitReason}>{permitText}</Text> : null}
                {permit.responsible_person ? <Text style={styles.permitResponsible}>负责人：{permit.responsible_person}</Text> : null}
                {permit.permit_id ? <Text style={styles.permitDone}>已同步到后台：#{permit.permit_id}</Text> : <Text style={styles.permitPending}>未拍照，后台暂不显示</Text>}
              </View>
              <TouchableOpacity style={styles.permitPhotoBtn} onPress={() => openPermitResponsible(index, permit)}>
                <Camera size={18} color="#0f766e" />
                <Text style={styles.permitPhotoText}>{permit.permit_id ? '重拍' : '拍照办理'}</Text>
              </TouchableOpacity>
            </View>
            );
          })}
        </View>
      ) : null}

      {items.map((item, idx) => {
        const severity = severityMeta(item.severity);
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
              {statusValue(item.status) === 'checked' ? (
                <View style={{ flex: 1 }}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
                    {(item.photo_url || '').split(',').filter(Boolean).map((url: string, index: number) => (
                      <TouchableOpacity key={index} onPress={() => setPreviewUrl(protectedFileUrl(url))}>
                        <Image source={{ uri: protectedFileUrl(url) }} style={styles.photoPreview} />
                      </TouchableOpacity>
                    ))}
                    <TouchableOpacity style={styles.addPhotoBtn} onPress={() => openCamera({ kind: 'add_photo', id: item.id })}>
                      <Text style={styles.addPhotoPlus}>+</Text>
                      <Text style={styles.addPhotoText}>追加照片</Text>
                    </TouchableOpacity>
                  </ScrollView>
                </View>
              ) : (
                <TouchableOpacity style={styles.photoButton} onPress={() => openCamera({ kind: 'check', id: item.id })}>
                  <View style={styles.photoPlaceholder}>
                    <Camera size={24} color="#0f766e" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.photoButtonTitle}>现场拍照确认</Text>
                    <Text style={styles.photoButtonSub}>只能打开相机，不能从相册选择</Text>
                  </View>
                </TouchableOpacity>
              )}
              
              <View style={[styles.checkStatus, statusValue(item.status) === 'checked' ? styles.checkedStatus : styles.pendingStatus]}>
                <CheckCircle2 size={14} color={statusValue(item.status) === 'checked' ? '#059669' : '#94a3b8'} />
                <Text style={[styles.checkStatusText, { color: statusValue(item.status) === 'checked' ? '#059669' : '#64748b' }]}>{statusValue(item.status) === 'checked' ? '已排查' : '待排查'}</Text>
              </View>
            </View>
          </View>
        );
      })}

      <TouchableOpacity
        style={[styles.submitBtn, !isAllChecked && styles.disabledButton]}
        onPress={() => {
          if (!isAllChecked) {
            Alert.alert('还不能归档', '请先完成所有隐患排查拍照，并把必须办理的作业许可拍照上传。');
            return;
          }
          Alert.alert('任务完成', '巡查任务已全部完成并归档。', [{ text: '返回', onPress: () => router.back() }]);
        }}
      >
        <Text style={styles.submitBtnText}>确认提交任务归档</Text>
      </TouchableOpacity>
      
      <Modal visible={!!previewUrl} transparent animationType="fade" onRequestClose={() => setPreviewUrl(null)}>
        <TouchableOpacity style={styles.previewContainer} onPress={() => setPreviewUrl(null)} activeOpacity={1}>
          {previewUrl ? <Image source={{ uri: previewUrl }} style={styles.previewImage} resizeMode="contain" /> : null}
          <Text style={styles.previewTip}>点击关闭</Text>
        </TouchableOpacity>
      </Modal>

      <Modal visible={!!permitResponsibleModal} transparent animationType="fade" onRequestClose={() => setPermitResponsibleModal(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.responsibleDialog}>
            <Text style={styles.responsibleTitle}>填写作业票据负责人</Text>
            <Text style={styles.responsibleHint}>负责人可以是施工员或实际作业负责人，填写后再现场拍照办理。</Text>
            <TextInput
              style={styles.responsibleInput}
              value={permitResponsibleName}
              onChangeText={setPermitResponsibleName}
              placeholder="请输入负责人姓名"
              placeholderTextColor="#94a3b8"
            />
            <View style={styles.responsibleActions}>
              <TouchableOpacity style={styles.responsibleCancel} onPress={() => setPermitResponsibleModal(null)}>
                <Text style={styles.responsibleCancelText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.responsibleConfirm} onPress={confirmPermitResponsible}>
                <Text style={styles.responsibleConfirmText}>去拍照</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  permitSection: { backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#dbe8e4', borderRadius: 22, padding: 14, marginBottom: 14 },
  sectionTitle: { color: '#0f172a', fontSize: 17, fontWeight: '900' },
  sectionHint: { color: '#64748b', fontSize: 12, lineHeight: 18, marginTop: 4, marginBottom: 10 },
  permitCard: { borderRadius: 16, backgroundColor: '#f8fafc', padding: 12, marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 10 },
  permitTitleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  permitTitle: { color: '#0f172a', fontWeight: '900', fontSize: 14 },
  permitLevel: { overflow: 'hidden', borderRadius: 999, backgroundColor: '#fef3c7', paddingHorizontal: 8, paddingVertical: 3, color: '#92400e', fontSize: 11, fontWeight: '900' },
  permitReason: { color: '#475569', marginTop: 4, fontSize: 12, lineHeight: 18 },
  permitResponsible: { color: '#0f766e', marginTop: 4, fontSize: 12, fontWeight: '900' },
  permitDone: { color: '#059669', marginTop: 6, fontSize: 12, fontWeight: '900' },
  permitPending: { color: '#d97706', marginTop: 6, fontSize: 12, fontWeight: '900' },
  permitPhotoBtn: { borderRadius: 14, backgroundColor: '#ccfbf1', paddingHorizontal: 10, paddingVertical: 9, alignItems: 'center', gap: 4 },
  permitPhotoText: { color: '#0f766e', fontSize: 12, fontWeight: '900' },
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
  photoButton: { borderWidth: 1, borderColor: '#b7d8d0', backgroundColor: '#f8fffd', padding: 10, borderRadius: 16, flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  photoPlaceholder: { width: 74, height: 74, borderRadius: 12, backgroundColor: '#ccfbf1', alignItems: 'center', justifyContent: 'center' },
  photoPreview: { width: 74, height: 74, borderRadius: 12, backgroundColor: '#e2e8f0' },
  photoButtonTitle: { color: '#0f172a', fontWeight: '900', fontSize: 14 },
  photoButtonSub: { color: '#64748b', marginTop: 3, fontSize: 12 },
  addPhotoBtn: { width: 74, height: 74, borderRadius: 12, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#cbd5e1', borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  addPhotoPlus: { fontSize: 24, color: '#94a3b8', fontWeight: '300', marginBottom: -4 },
  addPhotoText: { fontSize: 10, color: '#64748b', fontWeight: '700' },
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
  previewContainer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.94)', justifyContent: 'center', alignItems: 'center', padding: 12 },
  previewImage: { width: '100%', height: '88%' },
  previewTip: { color: '#fff', fontSize: 13, fontWeight: '800', marginTop: 12 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', justifyContent: 'center', padding: 22 },
  responsibleDialog: { borderRadius: 22, backgroundColor: '#ffffff', padding: 18 },
  responsibleTitle: { color: '#0f172a', fontSize: 18, fontWeight: '900' },
  responsibleHint: { color: '#64748b', fontSize: 13, lineHeight: 20, marginTop: 6 },
  responsibleInput: { marginTop: 14, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 11, color: '#0f172a', fontSize: 15, fontWeight: '700' },
  responsibleActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  responsibleCancel: { flex: 1, borderRadius: 14, backgroundColor: '#f1f5f9', paddingVertical: 12, alignItems: 'center' },
  responsibleCancelText: { color: '#475569', fontWeight: '900' },
  responsibleConfirm: { flex: 1, borderRadius: 14, backgroundColor: '#0f766e', paddingVertical: 12, alignItems: 'center' },
  responsibleConfirmText: { color: '#ffffff', fontWeight: '900' },
});
