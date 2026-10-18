import { useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
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
  /** Indexes of `children` (as a flat list, nulls dropped) that stick to the top while scrolling, each pushing off the last. */
  stickyHeaderIndices?: number[];
};

export function Screen({ children, edges = ['top'], onRefresh, header, footer, stickyHeaderIndices }: Props) {
  const theme = useTheme();
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    await onRefresh?.();
    setRefreshing(false);
  };

  const content = (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      stickyHeaderIndices={stickyHeaderIndices}
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={refresh} /> : undefined}>
      {children}
    </ScrollView>
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={edges}>
      {/* Pinned above the scroll area so it stays put while content scrolls. */}
      {header ??
        (edges.includes('top') && (
          <View style={styles.header}>
            <AppLogo />
          </View>
        ))}
      {footer ? (
        // Footer screens hold the fields being typed into; shrink so the bar rides above the keyboard.
        <KeyboardAvoidingView testID="keyboard-avoider" style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          {content}
          <BottomBar>{footer}</BottomBar>
        </KeyboardAvoidingView>
      ) : (
        content
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  fill: { flex: 1 },
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
