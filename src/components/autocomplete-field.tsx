import { useState } from 'react';
import { Pressable, StyleSheet, View, type TextInputProps } from 'react-native';

import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const MAX_SUGGESTIONS = 6;

type Props = Omit<TextInputProps, 'value' | 'onChangeText'> & {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  /** Offered while focused: those containing the typed text (all of them when empty), minus an exact match. */
  options: string[];
};

/** A text field that suggests existing values; tap one to fill it in, or keep typing a new one. */
export function AutocompleteField({ options, value, onChangeText, onFocus, onBlur, ...rest }: Props) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const typed = value.trim().toLowerCase();
  const matches = options.filter((o) => o.toLowerCase().includes(typed) && o.toLowerCase() !== typed).slice(0, MAX_SUGGESTIONS);

  return (
    <View style={styles.wrap}>
      <TextField
        value={value}
        onChangeText={onChangeText}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        {...rest}
      />
      {focused && matches.length > 0 && (
        <View style={styles.chips}>
          {matches.map((option) => (
            <Pressable
              key={option}
              onPress={() => onChangeText(option)}
              style={({ pressed }) => [styles.chip, { backgroundColor: theme.backgroundSelected, opacity: pressed ? 0.7 : 1 }]}>
              <ThemedText type="small">{option}</ThemedText>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { borderRadius: 16, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
});
