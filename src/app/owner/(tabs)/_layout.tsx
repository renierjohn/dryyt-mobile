import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { usePushNotifications } from '@/hooks/use-push-notifications';
import { useTheme } from '@/hooks/use-theme';

export default function OwnerTabs() {
  usePushNotifications('owner');
  const colors = useTheme();
  return (
    <NativeTabs
      backgroundColor={colors.backgroundElement}
      indicatorColor={colors.primarySoft}
      tintColor={colors.primary}
      labelStyle={{ selected: { color: colors.primary } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Drop offs</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="tray.and.arrow.down.fill" md="move_to_inbox" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="orders">
        <NativeTabs.Trigger.Label>Orders</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="bag.fill" md="shopping_bag" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="payouts">
        <NativeTabs.Trigger.Label>Payouts</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="banknote.fill" md="payments" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Label>Profile</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="person.fill" md="person" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
