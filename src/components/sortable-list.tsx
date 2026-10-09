import { useEffect, useMemo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector, type GestureType } from 'react-native-gesture-handler';
import Animated, { useAnimatedReaction, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

/** Item id -> its slot (0 = top). */
type Positions = Record<number, number>;

type Props<T extends { id: number }> = {
  items: T[];
  /** Every row is this tall, gap included: the slot math depends on it. */
  rowHeight: number;
  /** Wrap the drag handle in `handle`: it drags on touch. Holding anywhere else on the row for LONG_PRESS_MS also drags. */
  renderItem: (item: T, handle: (node: ReactNode) => ReactNode) => ReactNode;
  /** Called on drop with every id in the new order, only if the order changed. */
  onReorder: (ids: number[]) => void;
};

/** Hold this long anywhere on a row to pick it up. */
const LONG_PRESS_MS = 250;
/** Extra touch area around the handle, so it doesn't need a precise tap. */
const HANDLE_SLOP = 16;

const slotsOf = (items: { id: number }[]): Positions => Object.fromEntries(items.map((item, i) => [item.id, i]));

/** A fixed-height list reordered by dragging a row's handle, or by holding then dragging the row. */
export function SortableList<T extends { id: number }>({ items, rowHeight, renderItem, onReorder }: Props<T>) {
  const positions = useSharedValue<Positions>(slotsOf(items));

  // A refetch or an added/removed item resets the slots to the list as given.
  useEffect(() => {
    positions.set(slotsOf(items));
  }, [items, positions]);

  const drop = () => {
    const slots = positions.get();
    const ids = items.map((item) => item.id).sort((a, b) => slots[a] - slots[b]);
    if (ids.some((id, i) => id !== items[i].id)) onReorder(ids);
  };

  return (
    <View style={{ height: items.length * rowHeight }}>
      {items.map((item, i) => (
        <Row key={item.id} id={item.id} index={i} count={items.length} rowHeight={rowHeight} positions={positions} onDrop={drop}>
          {(handleGesture) => renderItem(item, (node) => <GestureDetector gesture={handleGesture}>{node}</GestureDetector>)}
        </Row>
      ))}
    </View>
  );
}

type RowProps = {
  id: number;
  index: number;
  count: number;
  rowHeight: number;
  positions: SharedValue<Positions>;
  onDrop: () => void;
  children: (gesture: GestureType) => ReactNode;
};

function Row({ id, index, count, rowHeight, positions, onDrop, children }: RowProps) {
  const top = useSharedValue(index * rowHeight);
  const start = useSharedValue(0);
  const dragging = useSharedValue(false);

  // Slide into a new slot when another row is dragged past this one.
  useAnimatedReaction(
    () => positions.get()[id],
    (slot, prev) => {
      if (slot === undefined || slot === prev || dragging.get()) return;
      top.set(withTiming(slot * rowHeight, { duration: 150 }));
    },
  );

  const [handleGesture, rowGesture] = useMemo(() => {
    const drag = () =>
      Gesture.Pan()
        .onStart(() => {
          dragging.set(true);
          start.set(top.get());
        })
        .onUpdate((e) => {
          top.set(Math.min(Math.max(start.get() + e.translationY, 0), (count - 1) * rowHeight));
          const to = Math.round(top.get() / rowHeight);
          const from = positions.get()[id];
          if (to === from) return;
          const next = { ...positions.get() };
          for (const key in next) if (next[key] === to) next[key] = from;
          next[id] = to;
          positions.set(next);
        })
        .onFinalize(() => {
          if (!dragging.get()) return;
          dragging.set(false);
          top.set(withTiming(positions.get()[id] * rowHeight, { duration: 150 }));
          scheduleOnRN(onDrop);
        });
    return [drag().minDistance(0).hitSlop(HANDLE_SLOP), drag().activateAfterLongPress(LONG_PRESS_MS)];
  }, [id, count, rowHeight, positions, onDrop, top, start, dragging]);

  const style = useAnimatedStyle(() => ({
    top: top.get(),
    zIndex: dragging.get() ? 1 : 0,
    opacity: dragging.get() ? 0.9 : 1,
    transform: [{ scale: withTiming(dragging.get() ? 1.03 : 1, { duration: 120 }) }],
  }));

  return (
    <GestureDetector gesture={rowGesture}>
      <Animated.View style={[styles.row, { height: rowHeight }, style]}>{children(handleGesture)}</Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  row: { position: 'absolute', left: 0, right: 0 },
});
