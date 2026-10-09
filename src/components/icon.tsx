import { SymbolView, type SymbolViewProps } from 'expo-symbols';

import { Brand } from '@/constants/theme';

type Props = { name: SymbolViewProps['name']; size?: number; color?: string };

export function Icon({ name, size = 28, color = Brand.primary }: Props) {
  return <SymbolView name={name} size={size} tintColor={color} />;
}
