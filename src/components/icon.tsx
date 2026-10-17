import { SymbolView, type SymbolViewProps } from 'expo-symbols';

import { Brand } from '@/constants/theme';

export type IconName = SymbolViewProps['name'];

type Props = { name: IconName; size?: number; color?: string };

export function Icon({ name, size = 28, color = Brand.primary }: Props) {
  return <SymbolView name={name} size={size} tintColor={color} />;
}
