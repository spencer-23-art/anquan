import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function registerForPushNotificationsAsync() {
  let token;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: '系统警告与任务派发',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
    });
  }

  if (Device.isDevice) {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      console.log('未获取到系统级弹窗推送权限!');
      return null;
    }
    
    // 生成全局 Expo 后台识别码
    try {
      token = (await Notifications.getExpoPushTokenAsync({
        projectId: 'safe-inspect-mobile' // 在真实 app.json 里需要配置
      })).data;
    } catch (e) {
      token = `${e}`;
    }
  } else {
    // 模拟器
    console.log('请在物理真机中使用消息推送');
  }

  return token;
}
