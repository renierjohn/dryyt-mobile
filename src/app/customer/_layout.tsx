import { Stack } from 'expo-router';

import { AppLogo } from '@/components/app-logo';
import { PICKUP_ENABLED } from '@/constants/features';

export default function CustomerLayout() {
  return (
    <Stack screenOptions={{ headerTitle: () => <AppLogo size={32} />, headerTitleAlign: 'center' }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      {/* Pickup screens: unreachable (even by link) while Pickup is switched off. */}
      <Stack.Protected guard={PICKUP_ENABLED}>
        <Stack.Screen name="pickup" options={{ title: 'Pickup', headerBackTitle: 'Back' }} />
        <Stack.Screen name="new-order" options={{ title: 'New order', headerBackTitle: 'Back' }} />
        <Stack.Screen name="order/[id]" options={{ title: 'Order', headerBackTitle: 'Back' }} />
      </Stack.Protected>
      <Stack.Screen name="stores" options={{ title: 'Choose a store', headerBackTitle: 'Back' }} />
      <Stack.Screen name="dropoff/location" options={{ title: 'Pickup location', headerBackTitle: 'Back' }} />
      <Stack.Screen name="dropoff/[id]" options={{ title: 'Drop off', headerBackTitle: 'Back' }} />
    </Stack>
  );
}
