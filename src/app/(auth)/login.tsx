import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/constants/theme';
import { useSessionStore } from '@/state/session-store';
import { ApiError } from '@/api/client';

export default function LoginScreen() {
  const theme = useTheme();
  const login = useSessionStore((s) => s.login);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!username.trim() || !password) {
      setError('Enter your username and password.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await login(username.trim(), password);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.form}>
          <ThemedText type="title" style={styles.title}>
            RestaurantCafe
          </ThemedText>
          <ThemedText type="subtitle" themeColor="textSecondary" style={styles.subtitle}>
            Staff sign in
          </ThemedText>

          {error && (
            <ThemedView style={styles.errorBox}>
              <ThemedText themeColor="text" style={styles.errorText}>
                {error}
              </ThemedText>
            </ThemedView>
          )}

          <TextInput
            value={username}
            onChangeText={setUsername}
            placeholder="Username"
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!submitting}
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          />
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            placeholderTextColor={theme.textSecondary}
            secureTextEntry
            editable={!submitting}
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          />

          <Pressable onPress={handleSubmit} disabled={submitting} style={[styles.button, submitting && styles.buttonDisabled]}>
            {submitting ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.buttonText}>Sign in</ThemedText>}
          </Pressable>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, justifyContent: 'center', paddingHorizontal: Spacing.four },
  form: { gap: Spacing.three },
  title: { textAlign: 'center', fontSize: 28, lineHeight: 34 },
  subtitle: { textAlign: 'center', marginBottom: Spacing.three },
  input: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  button: {
    backgroundColor: '#ea580c',
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    marginTop: Spacing.two,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  errorBox: {
    backgroundColor: '#fee2e2',
    borderRadius: Spacing.two,
    padding: Spacing.three,
  },
  errorText: { color: '#dc2626' },
});
