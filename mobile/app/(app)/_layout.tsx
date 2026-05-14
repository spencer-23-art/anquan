import { useState, useCallback, useMemo, useRef } from 'react';
import { Slot, useRouter, usePathname } from 'expo-router';
import {
  Animated,
  Easing,
  PanResponder,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import {
  CalendarDays,
  ClipboardCheck,
  FileCheck,
  FileText,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
  X,
} from 'lucide-react-native';
import { useAuthStore } from '../../src/stores/auth';
import { useAppTheme } from '../../src/hooks/useAppTheme';

const SIDEBAR_W = 260;

const NAV_LINKS = [
  { path: '/(app)', icon: ClipboardCheck, label: '任务执行' },
  { path: '/(app)/permits', icon: FileCheck, label: '作业许可' },
  { path: '/(app)/fines', icon: FileText, label: '在线罚单' },
  { path: '/(app)/safety-log', icon: CalendarDays, label: '安全日志' },
  { path: '/(app)/settings', icon: Settings, label: '设置' },
];

function isActive(pathname: string, linkPath: string) {
  if (linkPath === '/(app)') {
    return pathname === '/(app)' || pathname === '/(app)/index';
  }
  return pathname.startsWith(linkPath);
}

function getTitle(pathname: string) {
  if (pathname.startsWith('/(app)/task/')) return '风险排查';
  const link = NAV_LINKS.find((l) => isActive(pathname, l.path));
  return link?.label || '安全巡检';
}

export default function AppLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const logout = useAuthStore((state) => state.logout);
  const user = useAuthStore((state) => state.user);
  const { colors, resolved } = useAppTheme();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(false);
  const sidebarProgress = useRef(new Animated.Value(0)).current;

  const openSidebar = useCallback(() => {
    setSidebarVisible(true);
    setSidebarOpen(true);
    sidebarProgress.stopAnimation();
    Animated.timing(sidebarProgress, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [sidebarProgress]);

  const closeSidebar = useCallback(() => {
    sidebarProgress.stopAnimation();
    Animated.timing(sidebarProgress, {
      toValue: 0,
      duration: 180,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setSidebarOpen(false);
        setSidebarVisible(false);
      }
    });
  }, [sidebarProgress]);

  const swipeResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) => {
          const horizontalSwipe = Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.4;
          if (!horizontalSwipe || Math.abs(gesture.dx) < 10) return false;
          if (sidebarOpen) return gesture.dx < -10;
          return gesture.x0 <= 34 && gesture.dx > 10;
        },
        onPanResponderRelease: (_, gesture) => {
          if (!sidebarOpen && gesture.dx > 55) openSidebar();
          if (sidebarOpen && gesture.dx < -55) closeSidebar();
        },
      }),
    [closeSidebar, openSidebar, sidebarOpen]
  );

  const handleLogout = async () => {
    await logout();
    router.replace('/(auth)/login');
  };

  const navigate = useCallback(
    (path: string) => {
      closeSidebar();
      router.push(path as any);
    },
    [closeSidebar, router]
  );

  const currentTitle = getTitle(pathname);
  const sidebarTranslateX = sidebarProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [-SIDEBAR_W, 0],
  });

  return (
    <View style={styles.root} {...swipeResponder.panHandlers}>
      <LinearGradient
        colors={resolved === 'dark' ? ['#020617', '#000000'] : ['#ffffff', '#f1f5f9']}
        style={StyleSheet.absoluteFill}
      />
      {/* ===== 顶部 Header（与 web 端 mobile header 一致） ===== */}
      <BlurView intensity={100} tint={resolved === 'dark' ? 'dark' : 'light'} style={{ paddingTop: 40 }}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity
            style={[styles.menuBtn, { borderColor: resolved === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }]}
            onPress={openSidebar}
          >
            <Menu size={18} color={colors.text} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={[styles.headerSub, { color: colors.subtext }]}>安全巡检管理系统</Text>
            <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
              {currentTitle}
            </Text>
          </View>
        </View>
      </BlurView>

      {/* ===== 主内容区 ===== */}
      <View style={styles.content}>
        <Slot />
      </View>

      {/* ===== 侧边栏遮罩 + 抽屉 ===== */}
      {sidebarVisible && (
        <View style={StyleSheet.absoluteFill}>
          {/* 半透明遮罩 */}
          <Animated.View style={[styles.overlay, { opacity: sidebarProgress }]}>
            <Pressable style={StyleSheet.absoluteFill} onPress={closeSidebar} />
          </Animated.View>

          {/* 侧边栏 */}
          <Animated.View
            style={[
              styles.sidebar,
              {
                borderRightColor: colors.border,
                transform: [{ translateX: sidebarTranslateX }],
                overflow: 'hidden',
              },
            ]}
          >
          <BlurView intensity={90} tint={colors.bg === '#17211f' ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
          <SafeAreaView style={styles.sidebarSafe}>
            {/* 关闭按钮 */}
            <View style={styles.sidebarClose}>
              <TouchableOpacity
                style={[styles.closeBtn, { borderColor: 'rgba(150,150,150,0.2)' }]}
                onPress={closeSidebar}
              >
                <X size={18} color={colors.subtext} />
              </TouchableOpacity>
            </View>

            {/* Logo 区 */}
            <View style={[styles.logoArea, { borderBottomColor: colors.border }]}>
              <ShieldCheck size={30} color={colors.primary} />
              <View>
                <Text style={[styles.logoTitle, { color: colors.text }]}>安全巡检</Text>
                <Text style={[styles.logoSub, { color: colors.subtext }]}>SafeInspect</Text>
              </View>
            </View>

            {/* 导航列表 */}
            <View style={styles.navList}>
              {NAV_LINKS.map((link) => {
                const active = isActive(pathname, link.path);
                const IconComp = link.icon;
                return (
                  <TouchableOpacity
                    key={link.path}
                    style={[
                      styles.navItem,
                      active && { backgroundColor: colors.primary },
                    ]}
                    onPress={() => navigate(link.path)}
                    activeOpacity={0.7}
                  >
                    <IconComp size={20} color={active ? '#fff' : colors.text} />
                    <Text
                      style={[
                        styles.navLabel,
                        { color: active ? '#fff' : colors.text },
                      ]}
                    >
                      {link.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* 用户信息 + 退出 */}
            <View style={[styles.userArea, { borderTopColor: colors.border }]}>
              <View style={styles.userRow}>
                <View style={[styles.avatar, { backgroundColor: colors.primarySoft }]}>
                  <Text style={[styles.avatarText, { color: colors.primary }]}>
                    {(user?.username || '安')[0]}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.userName, { color: colors.text }]} numberOfLines={1}>
                    {user?.real_name || user?.username || '安全员'}
                  </Text>
                  <Text style={[styles.userRole, { color: colors.subtext }]}>
                    {user?.role === 'admin' ? '管理员' : user?.role === 'external' ? '其他单位' : '安全员'}
                  </Text>
                </View>
              </View>
              <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
                <LogOut size={20} color={colors.danger} />
                <Text style={[styles.logoutText, { color: colors.danger }]}>退出登录</Text>
              </TouchableOpacity>
            </View>
          </SafeAreaView>
          </Animated.View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  menuBtn: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 9,
  },
  headerCenter: { flex: 1 },
  headerSub: { fontSize: 11 },
  headerTitle: { fontSize: 15, fontWeight: '800' },
  // Content
  content: { flex: 1, overflow: 'hidden' },
  // Overlay
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15,23,42,0.35)',
  },
  // Sidebar
  sidebar: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    width: SIDEBAR_W,
    borderRightWidth: 1,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.18,
        shadowRadius: 16,
        shadowOffset: { width: 4, height: 0 },
      },
      android: { elevation: 16 },
      default: {},
    }),
  },
  sidebarSafe: { flex: 1 },
  sidebarClose: {
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  closeBtn: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 8,
  },
  // Logo
  logoArea: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 18,
    borderBottomWidth: 1,
  },
  logoTitle: { fontSize: 18, fontWeight: '900', letterSpacing: -0.3 },
  logoSub: { fontSize: 11 },
  // Nav
  navList: { flex: 1, paddingHorizontal: 12, paddingTop: 12, gap: 6 },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderRadius: 14,
  },
  navLabel: { fontSize: 14, fontWeight: '700' },
  // User
  userArea: { borderTopWidth: 1, paddingHorizontal: 16, paddingVertical: 16 },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 16, fontWeight: '900' },
  userName: { fontSize: 14, fontWeight: '700' },
  userRole: { fontSize: 11 },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
  },
  logoutText: { fontSize: 14, fontWeight: '700' },
});
