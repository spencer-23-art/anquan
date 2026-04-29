import { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Image, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import api, { protectedFileUrl } from '../../../src/services/api';

async function compressPhoto(uri: string) {
  const widths = [1080, 900, 720, 540];
  const qualities = [0.55, 0.45, 0.35, 0.28];
  let best = null;
  for (const width of widths) {
    for (const compress of qualities) {
      const result = await manipulateAsync(uri, [{ resize: { width } }], { compress, format: SaveFormat.JPEG });
      best = result;
      const response = await fetch(result.uri);
      const blob = await response.blob();
      if (blob.size <= 200 * 1024) {
        return result;
      }
    }
  }
  return best;
}

export default function ChecklistScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  
  const [task, setTask] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Camera state
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraActive, setCameraActive] = useState(false);
  const [activeItemId, setActiveItemId] = useState(null);
  const cameraRef = useRef(null);

  useEffect(() => {
    // 获取单条任务详情，后端已实现 get_task 接口
    api.get(`tasks/${id}`)
      .then(res => {
        setTask(res.data);
        setItems(res.data.checklist_items || []); 
      })
      .catch(err => {
        console.error("加载任务详情失败:", err);
      })
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <View style={styles.center}><ActivityIndicator color="#dc2626"/></View>;
  if (!permission) return <View style={styles.center}><ActivityIndicator /></View>;
  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>巡查应用需要获取相机权限进行严格的现场打卡拍照。</Text>
        <TouchableOpacity style={styles.btn} onPress={requestPermission}><Text style={styles.btnText}>授权相机</Text></TouchableOpacity>
      </View>
    );
  }

  const openCamera = (itemId) => {
    setActiveItemId(itemId);
    setCameraActive(true);
  };

  const takePicture = async () => {
    if (cameraRef.current) {
      const photo = await cameraRef.current.takePictureAsync();
      setCameraActive(true); // 保持 loading 状态

      try {
        // 1. 压缩图片
        const compressedImage = await compressPhoto(photo.uri);

        // 2. 准备 FormData 上传
        const formData = new FormData();
        formData.append('note', '通过移动端实地拍摄');
        
        // React Native 中的文件上传格式
        const fileData = {
          uri: compressedImage.uri,
          name: `check_${activeItemId}.jpg`,
          type: 'image/jpeg',
        };
        formData.append('photo', fileData as any);

        // 3. 调用后端接口
        await api.post(`tasks/${id}/items/${activeItemId}/check`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });

        // 4. 更新本地状态
        setItems(prev => prev.map(i => 
          i.id === activeItemId ? { ...i, photo_url: compressedImage.uri, status: 'checked' } : i
        ));
        setCameraActive(false);
      } catch (err) {
        console.warn("打卡失败:", err);
        alert("上传照片失败，请检查网络连接");
        setCameraActive(false);
      }
    }
  };

  if (cameraActive) {
    return (
      <View style={{flex: 1}}>
        <CameraView style={{flex: 1}} facing="back" ref={cameraRef}>
          <View style={styles.cameraOverlay}>
            <Text style={styles.cameraAlert}>实时现场勘查取证中 (禁止相册)</Text>
            <TouchableOpacity style={styles.captureButton} onPress={takePicture}>
              <View style={styles.captureInner} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelButton} onPress={() => setCameraActive(false)}>
              <Text style={{color: '#fff', fontWeight: 'bold'}}>取消</Text>
            </TouchableOpacity>
          </View>
        </CameraView>
      </View>
    )
  }

  const isAllChecked = items.every(item => item.status === 'checked');

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{task?.title}</Text>
        <Text style={styles.desc}>{task?.description}</Text>
        <View style={styles.badgeRow}>
           <Text style={styles.areaBadge}>📍 {task?.area?.name}</Text>
           <Text style={styles.statusBadge}>{task?.status === 'completed' ? '✅ 已完成' : '🕒 进行中'}</Text>
        </View>
      </View>

      <Text style={styles.subtext}>巡查清单项目 ({items.filter(i => i.status === 'checked').length}/{items.length})：</Text>
      {items.map((item, idx) => (
        <View key={item.id} style={styles.checkCard}>
          <View style={styles.checkHeader}>
            <Text style={styles.riskText}>{idx + 1}. {item.risk_description}</Text>
            <Text style={styles.severity}>{item.severity === 'high' ? '🔴高危' : item.severity === 'medium' ? '🟡中危' : '🟢低危'}</Text>
          </View>
          
          <View style={styles.guidanceBox}>
            <Text style={styles.guidanceTitle}>如何确认安全</Text>
            <Text style={styles.guidanceText}>{item.measure || '按后台下发的风险要求，对人员、设备、环境和防护措施逐项核查，确认无异常后拍照上传。'}</Text>
          </View>

          <View style={styles.actionRow}>
            {item.photo_url ? (
              <TouchableOpacity onPress={() => openCamera(item.id)}>
                <Image source={{ uri: item.photo_url.startsWith('/') ? protectedFileUrl(item.photo_url) : item.photo_url }} style={styles.photoPreview} />
                <Text style={styles.retakeText}>重新现场拍照</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.camBtn} onPress={() => openCamera(item.id)}>
                <Text style={styles.btnText}>📷 现场拍照确认(必填)</Text>
              </TouchableOpacity>
            )}
            
            {item.status === 'checked' ? (
              <View style={styles.statusBoxGreen}><Text style={{color: '#22c55e', fontWeight:'bold'}}>已验收</Text></View>
            ) : (
              <View style={styles.statusBoxGray}><Text style={{color: '#a1a1aa', fontWeight:'bold'}}>待打卡</Text></View>
            )}
          </View>
        </View>
      ))}

      <TouchableOpacity 
        style={[styles.submitBtn, !isAllChecked && { opacity: 0.5 }]} 
        onPress={() => {
          if (!isAllChecked) {
            alert('请先完成所有项目的拍照打卡！');
            return;
          }
          alert('巡查任务已全部完成并归档！'); 
          router.back();
        }}
      >
        <Text style={styles.submitBtnText}>确认提交任务归档</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#09090b', padding: 20 },
  text: { color: '#fafafa', marginBottom: 20, textAlign: 'center'},
  btn: { backgroundColor: '#dc2626', padding: 12, borderRadius: 8 },
  btnText: { color: '#fff', fontWeight: 'bold' },
  
  container: { flex: 1, backgroundColor: '#09090b', padding: 16 },
  header: { borderBottomWidth: 1, borderBottomColor: '#27272a', paddingBottom: 16, marginBottom: 16 },
  title: { fontSize: 22, fontWeight: 'bold', color: '#fafafa' },
  desc: { fontSize: 14, color: '#a1a1aa', marginTop: 8 },
  badgeRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  areaBadge: { backgroundColor: '#27272a', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, fontSize: 12, color: '#fafafa' },
  statusBadge: { backgroundColor: '#dc262620', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, fontSize: 12, color: '#dc2626', fontWeight: '600' },
  subtext: { fontSize: 16, fontWeight: 'bold', color: '#fafafa', marginBottom: 12 },
  
  checkCard: { backgroundColor: '#18181b', padding: 16, borderRadius: 8, marginBottom: 16, borderWidth: 1, borderColor: '#27272a' },
  checkHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  riskText: { fontSize: 15, color: '#fafafa', flex: 1, fontWeight: '600' },
  severity: { fontSize: 14, fontWeight: 'bold', marginLeft: 10 },
  guidanceBox: { backgroundColor: '#0f172a', borderRadius: 8, padding: 12, marginTop: 10 },
  guidanceTitle: { color: '#93c5fd', fontWeight: 'bold', marginBottom: 5 },
  guidanceText: { color: '#dbeafe', fontSize: 13, lineHeight: 19 },
  
  actionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 10 },
  camBtn: { backgroundColor: '#27272a', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 6, borderWidth: 1, borderColor: '#3f3f46' },
  photoPreview: { width: 80, height: 60, borderRadius: 4 },
  retakeText: { color: '#a1a1aa', fontSize: 11, marginTop: 4 },
  statusBoxGreen: { backgroundColor: '#22c55e20', padding: 6, borderRadius: 4 },
  statusBoxGray: { backgroundColor: '#27272a', padding: 6, borderRadius: 4 },

  cameraOverlay: { flex: 1, justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 50 },
  cameraAlert: { position: 'absolute', top: 50, color: '#ef4444', fontWeight: 'bold', fontSize: 18, backgroundColor: 'rgba(0,0,0,0.5)', padding: 10, borderRadius: 8},
  captureButton: { width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(255, 255, 255, 0.3)', justifyContent: 'center', alignItems: 'center' },
  captureInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#fff' },
  cancelButton: { marginTop: 20 },

  submitBtn: { backgroundColor: '#dc2626', padding: 16, borderRadius: 8, alignItems: 'center', marginTop: 20, marginBottom: 40 },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: 'bold' }
});
