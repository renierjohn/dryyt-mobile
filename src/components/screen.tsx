import { useState, type ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { AppLogo } from '@/components/app-logo';
import { BottomBar } from '@/components/bottom-bar';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  children: ReactNode;
  /** Use `[]` on screens that show a navigation header or a `header` band. */
  edges?: Edge[];
  onRefresh?: () => Promise<unknown>;
  /** Replaces the default logo header. */
  header?: ReactNode;
  /** Sticky actions pinned below the scroll area. */
  footer?: ReactNode;
};

export function Screen({ children, edges = ['top'], onRefresh, header, footer }: Props) {
  const theme = useTheme();
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    await onRefresh?.();
    setRefreshing(false);
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={edges}>
      {/* Pinned above the scroll area so it stays put while content scrolls. */}
      {header ??
        (edges.includes('top') && (
          <View style={styles.header}>
            <AppLogo />
          </View>
        ))}
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={refresh} /> : undefined}>
        {children}
      </ScrollView>
      {footer && <BottomBar>{footer}</BottomBar>}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { paddingTop: Spacing.three, paddingBottom: Spacing.two },
  content: {
    padding: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.three,
    gap: Spacing.three,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
});
