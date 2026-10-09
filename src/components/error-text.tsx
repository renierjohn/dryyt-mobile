import { ThemedText } from '@/components/themed-text';
import { Brand } from '@/constants/theme';

export function ErrorText({ error }: { error: Error | null }) {
  if (!error) return null;
  return (
    <ThemedText type="small" style={{ color: Brand.danger }}>
      {error.message}
    </ThemedText>
  );
}
