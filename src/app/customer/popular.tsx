import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { CartButton } from '@/components/cart-button';
import { CategoryChips } from '@/components/category-chips';
import { ErrorText } from '@/components/error-text';
import { Icon } from '@/components/icon';
import { openMenuItem } from '@/components/menu-item-card';
import { Screen } from '@/components/screen';
import { groupByStore, StoreGroup } from '@/components/store-group';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { usePopularMenu } from '@/hooks/queries';
import { useTheme } from '@/hooks/use-theme';

const LIMIT = 50;
const SEARCH_DELAY_MS = 300;

export default function Popular() {
  const theme = useTheme();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  // Search once typing pauses, not on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const popular = usePopularMenu({ limit: LIMIT, q, category });
  const items = popular.data?.items ?? [];
  const groups = groupByStore(items);
  const filtered = q !== '' || category !== null;
  const clear = () => {
    setText('');
    setQ('');
    setCategory(null);
  };

  return (
    <View style={styles.fill}>
      <Screen edges={[]} onRefresh={popular.refetch}>
        <View style={[styles.search, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <Icon name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }} size={18} color={theme.textSecondary} />
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Search dishes"
            placeholderTextColor={theme.textSecondary}
            returnKeyType="search"
            autoCorrect={false}
            style={[styles.input, { color: theme.text }]}
          />
        </View>
        <CategoryChips categories={popular.data?.categories ?? []} selected={category} onSelect={setCategory} />
        {popular.isPending && <ActivityIndicator />}
        <ErrorText error={popular.error} />
        {popular.isSuccess && items.length === 0 && (
          <View style={styles.empty}>
            <ThemedText themeColor="textSecondary">{q ? `No dishes match “${q}”.` : filtered ? 'No dishes in this category.' : 'Nothing on the menu yet.'}</ThemedText>
            {filtered && <Button title="Clear filters" variant="secondary" onPress={clear} />}
          </View>
        )}
        {/* Last results stay, dimmed, while a new search loads. */}
        <View style={[styles.groups, popular.isPlaceholderData && styles.dimmed]}>
          {groups.map((group) => (
            <StoreGroup
              key={group.storeId}
              group={group}
              onOpenStore={(storeId) => router.push({ pathname: '/customer/new-order', params: { storeId: String(storeId) } })}
              onOpenItem={openMenuItem}
            />
          ))}
        </View>
      </Screen>
      <CartButton />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  search: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderWidth: 1, borderRadius: 999, paddingHorizontal: Spacing.three },
  input: { flex: 1, minHeight: 44, fontSize: 16 },
  empty: { gap: Spacing.three },
  groups: { gap: Spacing.four },
  dimmed: { opacity: 0.5 },
});
