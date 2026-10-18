import type { ImageSource } from 'expo-image';
import { Pressable, Text } from 'react-native';

/** Stand-in for tests (the real viewer needs Reanimated's native side): shows the photo's URL; tap to close. */
export function PhotoViewer({ source, onClose }: { source: ImageSource | null; onClose: () => void }) {
  if (!source) return null;
  return (
    <Pressable testID="photo-viewer" onPress={onClose}>
      <Text>{source.uri}</Text>
    </Pressable>
  );
}
