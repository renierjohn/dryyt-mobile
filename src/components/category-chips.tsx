import { Pressable, ScrollView, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = { categories: string[]; selected: string | null; onSelect: (category: string | null) => void };

/** "All" plus one chip per category in a scrolling row; tapping the selected chip clears it. Nothing when there are none. */
export function CategoryChips({ categories, selected, onSelect }: Props) {
  if (!categories.length) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      <Chip label="All" active={selected === null} onPress={() => onSelect(null)} />
      {categories.map((category) => (
        <Chip key={category} label={category} active={selected === category} onPress={() => onSelect(selected === category ? null : category)} />
      ))}
    </ScrollView>
  );
}

export function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [styles.chip, { backgroundColor: active ? theme.primary : theme.primarySoft, opacity: pressed ? 0.7 : 1 }]}>
      <ThemedText type="smallBold" style={{ color: active ? theme.onPrimary : theme.primary }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { gap: Spacing.two },
  chip: { borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
});
