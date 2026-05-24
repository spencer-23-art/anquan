import { useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ShieldCheck } from 'lucide-react-native';
import api from '../../src/services/api';
import { useAuthStore } from '../../src/stores/auth';
import { useAppTheme } from '../../src/hooks/useAppTheme';

export default function LoginScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const usernameRef = useRef('');
  const [password, setPassword] = useState('');
  const [rememberLogin, setRememberLogin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const setToken = useAuthStore((state) => state.setToken);

  const normalizeUsername = (value: string) =>
    value.normalize('NFKC').replace(/[\s\u200B-\u200D\uFEFF]/g, '');

  const handleLogin = async () => {
    const loginUsername = normalizeUsername(usernameRef.current);
    if (!loginUsername || !password) {
      setError('请输入用户名和密码');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await api.post('auth/login', { username: loginUsername, password });
      await setToken(res.data.access_token, res.data.user, rememberLogin);
    } catch (err: any) {
      if (err.response?.status === 401) {
        setError('登录失败，请检查账号和密码');
      } else if (err.response?.status === 403) {
        setError(err.response?.data?.detail || '账号尚未通过审批');
      } else {
        setError('登录请求失败，请检查网络或服务器地址');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.page, { backgroundColor: colors.bg }]}>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[styles.logo, { backgroundColor: colors.primarySoft }]}>
          <ShieldCheck size={30} color={colors.primary} />
        </View>
        <Text style={[styles.title, { color: colors.text }]}>安全巡检管理系统</Text>
        <Text style={[styles.subtitle, { color: colors.subtext }]}>登录后进入安全任务、作业许可和在线罚单。</Text>

        <Text style={[styles.label, { color: colors.text }]}>用户名</Text>
        <TextInput
          style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.cardSoft }]}
          placeholder="请输入账号"
          placeholderTextColor={colors.subtext}
          defaultValue=""
          onChangeText={(text) => { usernameRef.current = text; }}
          autoCapitalize="none"
        />

        <Text style={[styles.label, { color: colors.text }]}>密码</Text>
        <TextInput
          style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.cardSoft }]}
          placeholder="请输入密码"
          placeholderTextColor={colors.subtext}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          onSubmitEditing={handleLogin}
        />

        <TouchableOpacity
          style={[styles.rememberRow, { borderColor: colors.border, backgroundColor: colors.cardSoft }]}
          activeOpacity={0.85}
          onPress={() => setRememberLogin((value) => !value)}
        >
          <Text style={[styles.rememberText, { color: colors.text }]}>保持登录，下次自动进入</Text>
          <View style={[styles.checkbox, { borderColor: rememberLogin ? colors.primary : colors.border, backgroundColor: rememberLogin ? colors.primary : 'transparent' }]}>
            {rememberLogin ? <Text style={styles.checkboxMark}>✓</Text> : null}
          </View>
        </TouchableOpacity>

        {error ? <Text style={[styles.error, { color: colors.danger, backgroundColor: `${colors.danger}14` }]}>{error}</Text> : null}

        <TouchableOpacity style={[styles.button, { backgroundColor: colors.primary }]} onPress={handleLogin} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>登录</Text>}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => router.push('/(auth)/register')} style={styles.linkButton}>
          <Text style={{ color: colors.primary }}>还没有账号？去注册</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, justifyContent: 'center', padding: 18 },
  card: { borderWidth: 1, borderRadius: 28, padding: 24, shadowColor: '#0f172a', shadowOpacity: 0.08, shadowRadius: 20, elevation: 3 },
  logo: { width: 58, height: 58, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  title: { fontSize: 28, fontWeight: '900', letterSpacing: -0.8 },
  subtitle: { marginTop: 8, marginBottom: 28, fontSize: 14, lineHeight: 22 },
  label: { marginBottom: 8, fontSize: 14, fontWeight: '700' },
  input: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, marginBottom: 18, fontSize: 16 },
  rememberRow: { marginBottom: 18, borderWidth: 1, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rememberText: { fontSize: 14, fontWeight: '700' },
  checkbox: { width: 22, height: 22, borderWidth: 1.5, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  checkboxMark: { color: '#fff', fontSize: 15, fontWeight: '900', lineHeight: 18 },
  error: { borderRadius: 14, padding: 12, marginBottom: 16, fontWeight: '700' },
  button: { borderRadius: 16, paddingVertical: 16, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '800' },
  linkButton: { alignItems: 'center', marginTop: 20 },
});
