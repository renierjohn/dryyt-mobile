import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { usePushNotifications } from '@/hooks/use-push-notifications';
import { useTheme } from '@/hooks/use-theme';

export default function OwnerTabs() {
  usePushNotifications('owner');
  const colors = useTheme();
  return (
    <NativeTabs
      backgroundColor={colors.background}
      indicatorColor={colors.backgroundElement}
      labelStyle={{ selected: { color: colors.text } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Drop offs</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="tray.and.arrow.down.fill" md="move_to_inbox" />
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
