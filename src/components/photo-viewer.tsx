import { Image, type ImageSource } from 'expo-image';
import { Modal, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { Spacing } from '@/constants/theme';

const MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 2.5;

/** Full-screen photo, open while `source` is set: pinch or double-tap to zoom, drag to look around once zoomed. */
export function PhotoViewer({ source, onClose }: { source: ImageSource | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={source !== null} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      {/* A Modal is its own native root on Android, so gestures need their own root view. */}
      <GestureHandlerRootView style={styles.backdrop}>
        {source && <ZoomableImage source={source} />}
        <Pressable
          testID="photo-viewer-close"
          accessibilityLabel="Close photo"
          hitSlop={16}
          onPress={onClose}
          style={[styles.close, { top: insets.top + Spacing.two }]}>
          <Icon name={{ ios: 'xmark', android: 'close', web: 'close' }} size={24} color="#FFFFFF" />
        </Pressable>
      </GestureHandlerRootView>
    </Modal>
  );
}

function ZoomableImage({ source }: { source: ImageSource }) {
  const { width, height } = useWindowDimensions();
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);

  /** Keeps the zoomed photo covering the screen: no dragging past its edges. */
  const clampPan = (value: number, size: number, zoom: number) => {
    'worklet';
    const max = (size * (zoom - 1)) / 2;
    return Math.min(max, Math.max(-max, value));
  };
  const zoomTo = (zoom: number) => {
    'worklet';
    scale.set(withTiming(zoom));
    savedScale.set(zoom);
    const nextX = clampPan(x.get(), width, zoom);
    const nextY = clampPan(y.get(), height, zoom);
    x.set(withTiming(nextX));
    y.set(withTiming(nextY));
    savedX.set(nextX);
    savedY.set(nextY);
  };

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.set(Math.min(MAX_SCALE, Math.max(1, savedScale.get() * e.scale)));
    })
    .onEnd(() => zoomTo(scale.get()));
  const pan = Gesture.Pan()
    .averageTouches(true)
    .onUpdate((e) => {
      x.set(clampPan(savedX.get() + e.translationX, width, scale.get()));
      y.set(clampPan(savedY.get() + e.translationY, height, scale.get()));
    })
    .onEnd(() => {
      savedX.set(x.get());
      savedY.set(y.get());
    });
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => zoomTo(savedScale.get() > 1 ? 1 : DOUBLE_TAP_SCALE));

  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }, { translateY: y.get() }, { scale: scale.get() }] }));

  return (
    <GestureDetector gesture={Gesture.Simultaneous(pinch, pan, doubleTap)}>
      <Animated.View style={[styles.fill, style]}>
        <Image testID="photo-viewer-image" source={source} style={styles.fill} contentFit="contain" />
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.92)' },
  fill: { flex: 1 },
  close: { position: 'absolute', right: Spacing.three, padding: Spacing.two, borderRadius: 999, backgroundColor: 'rgba(255, 255, 255, 0.15)' },
});
