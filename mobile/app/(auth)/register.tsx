import { useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { UserPlus } from 'lucide-react-native';
import api from '../../src/services/api';
import { useAppTheme } from '../../src/hooks/useAppTheme';

export default function RegisterScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const [username, setUsername] = useState('');
  const [realName, setRealName] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleRegister = async () => {
    if (!username.trim() || !password || !realName.trim()) {
      setError('请填写账号、姓名和密码');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await api.post('auth/register', {
        username: username.trim(),
        password,
        real_name: realName.trim(),
      });
      Alert.alert('申请已提交', '请等待管理员在后台审核，通过后即可登录客户端。', [
        { text: '我知道了', onPress: () => router.replace('/(auth)/login') },
      ]);
    } catch (err: any) {
      setError(err.response?.data?.detail || '注册失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.page, { backgroundColor: colors.bg }]}>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[styles.logo, { backgroundColor: colors.primarySoft }]}>
          <UserPlus size={28} color={colors.primary} />
        </View>
        <Text style={[styles.title, { color: colors.text }]}>申请安全员账号</Text>
        <Text style={[styles.subtitle, { color: colors.subtext }]}>提交后由管理员审核，审核通过才能进入客户端。</Text>

        <TextInput style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.cardSoft }]} placeholder="登录账号，可填写中文姓名" placeholderTextColor={colors.subtext} value={username} onChangeText={setUsername} keyboardType="default" autoCapitalize="none" autoCorrect={false} autoComplete="off" textContentType="none" />
        <TextInput style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.cardSoft }]} placeholder="真实姓名，可填写中文" placeholderTextColor={colors.subtext} value={realName} onChangeText={setRealName} keyboardType="default" autoComplete="off" textContentType="none" />
        <TextInput style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.cardSoft }]} placeholder="密码，至少 6 位" placeholderTextColor={colors.subtext} secureTextEntry value={password} onChangeText={setPassword} />

        {error ? <Text style={[styles.error, { color: colors.danger, backgroundColor: `${colors.danger}14` }]}>{error}</Text> : null}

        <TouchableOpacity style={[styles.button, { backgroundColor: colors.primary }]} onPress={handleRegister} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>提交注册申请</Text>}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => router.back()} style={styles.linkButton}>
          <Text style={{ color: colors.primary }}>已有账号？返回登录</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, justifyContent: 'center', padding: 18 },
  card: { borderWidth: 1, borderRadius: 28, padding: 24, shadowColor: '#0f172a', shadowOpacity: 0.08, shadowRadius: 20, elevation: 3 },
  logo: { width: 58, height: 58, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  title: { fontSize: 26, fontWeight: '900', letterSpacing: -0.6 },
  subtitle: { marginTop: 8, marginBottom: 24, fontSize: 14, lineHeight: 22 },
  input: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, marginBottom: 14, fontSize: 16 },
  error: { borderRadius: 14, padding: 12, marginBottom: 14, fontWeight: '700' },
  button: { borderRadius: 16, paddingVertical: 16, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '800' },
  linkButton: { alignItems: 'center', marginTop: 20 },
});
