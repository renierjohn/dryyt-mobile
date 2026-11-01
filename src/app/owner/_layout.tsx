import { Stack } from 'expo-router';

import { AppLogo } from '@/components/app-logo';

export default function OwnerLayout() {
  // freezeOnBlur: screens under the top one stop re-rendering until shown again; their sockets and effects keep running.
  return (
    <Stack screenOptions={{ headerTitle: () => <AppLogo size={32} />, headerTitleAlign: 'center', freezeOnBlur: true }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="dropoff/[id]" options={{ title: 'Drop off', headerBackTitle: 'Back' }} />
      <Stack.Screen name="store/[id]" options={{ title: 'Shop', headerBackTitle: 'Back' }} />
      <Stack.Screen name="menu-item" options={{ title: 'Menu item', headerBackTitle: 'Back' }} />
    </Stack>
  );
}
