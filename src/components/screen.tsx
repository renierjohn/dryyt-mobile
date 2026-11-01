import { Children, useState, type ReactElement, type ReactNode } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
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
  /** Mount only the rows near the viewport; for long lists. Each child is one row. */
  virtualized?: boolean;
};

export function Screen({ children, edges = ['top'], onRefresh, header, footer, stickyHeaderIndices, virtualized }: Props) {
  const theme = useTheme();
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    await onRefresh?.();
    setRefreshing(false);
  };

  const refreshControl = onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={refresh} /> : undefined;
  const content = virtualized ? (
    <FlatList
      // toArray drops null rows and keys the rest, so `stickyHeaderIndices` line up as they do in the ScrollView.
      data={Children.toArray(children) as ReactElement[]}
      renderItem={({ item }) => item}
      keyExtractor={(item) => String(item.key)}
      // Day titles and separator lines are rows too, so the default 10 can leave a tall screen half empty at first.
      initialNumToRender={20}
      // Android defaults this to true, which can leave rows (and their images) blank next to sticky headers.
      removeClippedSubviews={false}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      stickyHeaderIndices={stickyHeaderIndices}
      refreshControl={refreshControl}
    />
  ) : (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      stickyHeaderIndices={stickyHeaderIndices}
      refreshControl={refreshControl}>
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
