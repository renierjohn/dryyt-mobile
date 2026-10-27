import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { useAuth } from '@/hooks/use-auth';
import { usePushNotifications } from '@/hooks/use-push-notifications';
import { useTheme } from '@/hooks/use-theme';

/** Guests get Home and Login; signed-in customers Home, Orders and Profile. */
export default function CustomerTabs() {
  const signedIn = useAuth().state.status === 'signedIn';
  usePushNotifications('customer', signedIn);
  const colors = useTheme();
  return (
    <NativeTabs
      backgroundColor={colors.backgroundElement}
      indicatorColor={colors.primarySoft}
      tintColor={colors.primary}
      labelStyle={{ selected: { color: colors.primary } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="house.fill" md="home" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="orders" hidden={!signedIn}>
        <NativeTabs.Trigger.Label>Orders</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="list.bullet" md="receipt_long" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile" hidden={!signedIn}>
        <NativeTabs.Trigger.Label>Profile</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="person.fill" md="person" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="login" hidden={signedIn}>
        <NativeTabs.Trigger.Label>Login</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="person.crop.circle.badge.plus" md="login" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
