import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import NetInfo from '@react-native-community/netinfo';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useSessionStore } from '@/state/session-store';
import { useOutboxStore } from '@/state/outbox-store';
import { flushOutbox } from '@/offline/sync-engine';
import { useLocaleStore, type Locale } from '@/state/locale-store';
import { useT } from '@/lib/i18n';

export default function SettingsScreen() {
  const t = useT();
  const user = useSessionStore((s) => s.user);
  const logout = useSessionStore((s) => s.logout);
  const entries = useOutboxStore((s) => s.entries);
  const syncing = useOutboxStore((s) => s.syncing);
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    return NetInfo.addEventListener((s) => setOnline(Boolean(s.isConnected && s.isInternetReachable !== false)));
  }, []);

  const waiting = entries.filter((e) => e.status !== 'failed').length;
  const failed = entries.filter((e) => e.status === 'failed').length;

  function handleLogout() {
    if (waiting + failed === 0) {
      void logout();
      return;
    }
    Alert.alert(t('settings.unsentOrdersTitle'), t('settings.unsentOrdersMessage', { n: waiting + failed }), [
      { text: t('settings.staySignedIn'), style: 'cancel' },
      { text: t('settings.signOutAnyway'), style: 'destructive', onPress: () => void logout() },
    ]);
  }

  const languages: { value: Locale; label: string }[] = [
    { value: 'en', label: t('settings.english') },
    { value: 'ms', label: t('settings.malay') },
  ];

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="subtitle">{t('settings.title')}</ThemedText>

        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="smallBold">{user?.name}</ThemedText>
          <ThemedText themeColor="textSecondary">{user?.username}</ThemedText>
          <ThemedText themeColor="textSecondary">{user?.roles.join(', ')}</ThemedText>
          <ThemedText themeColor="textSecondary">{user?.restaurantName}</ThemedText>
        </ThemedView>

        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="smallBold">{t('settings.language')}</ThemedText>
          <ThemedView type="backgroundElement" style={styles.languageRow}>
            {languages.map((l) => (
              <Pressable key={l.value} onPress={() => setLocale(l.value)} style={[styles.languageOption, locale === l.value && styles.languageOptionActive]}>
                <ThemedText style={locale === l.value ? styles.languageOptionTextActive : undefined}>{l.label}</ThemedText>
              </Pressable>
            ))}
          </ThemedView>
        </ThemedView>

        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="smallBold">{t('settings.connection')}</ThemedText>
          <ThemedText themeColor="textSecondary">{online === null ? t('settings.checking') : online ? t('settings.online') : t('settings.offline')}</ThemedText>
          <ThemedText themeColor="textSecondary">
            {t('settings.waitingToSendCount', { n: waiting })}
            {failed > 0 ? t('settings.notAcceptedCount', { n: failed }) : ''}
          </ThemedText>
          <Pressable onPress={() => void flushOutbox()} disabled={syncing} style={[styles.syncButton, syncing && styles.disabled]}>
            <ThemedText style={styles.syncText}>{syncing ? t('settings.sending') : t('settings.sendNow')}</ThemedText>
          </Pressable>
        </ThemedView>

        <Pressable onPress={handleLogout} style={styles.logoutButton}>
          <ThemedText style={styles.logoutText}>{t('common.signOut')}</ThemedText>
        </Pressable>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, padding: Spacing.three, gap: Spacing.three },
  card: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.one },
  languageRow: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.one },
  languageOption: { flex: 1, paddingVertical: Spacing.two, borderRadius: Spacing.two, alignItems: 'center', backgroundColor: 'rgba(128,128,128,0.15)' },
  languageOptionActive: { backgroundColor: '#ea580c' },
  languageOptionTextActive: { color: '#fff', fontWeight: '600' },
  syncButton: { backgroundColor: '#ea580c', borderRadius: Spacing.two, paddingVertical: Spacing.two, alignItems: 'center', marginTop: Spacing.two },
  syncText: { color: '#fff', fontWeight: '600' },
  disabled: { opacity: 0.6 },
  logoutButton: {
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#dc2626',
    marginTop: 'auto',
  },
  logoutText: { color: '#dc2626', fontWeight: '600' },
});
