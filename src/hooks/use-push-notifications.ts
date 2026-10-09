import { useQueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

import { api } from '@/lib/api';
import type { Role } from '@/lib/types';

// Show pushes while the app is open too. Drivers on a live dispatch socket get no "new drop off" push (the worker skips
// them), so this can't double up with the socket.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

/** Every push the worker sends carries the drop off it's about. */
const transactionOf = (n: Notifications.Notification) => {
  const id = Number(n.request.content.data?.transaction_id);
  return Number.isInteger(id) && id > 0 ? id : null;
};

type Step = 'channel' | 'permission' | 'projectId' | 'getExpoPushTokenAsync' | 'save';

class RegistrationError extends Error {
  constructor(
    readonly step: Step,
    message: string,
  ) {
    super(message);
  }
}

/** Runs one registration step, tagging any failure with the step so the worker log says where it broke. */
async function step<T>(name: Step, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    throw err instanceof RegistrationError ? err : new RegistrationError(name, err instanceof Error ? err.message : String(err));
  }
}

/**
 * Gets this phone's Expo push token and saves it on the server. Throws a RegistrationError naming the failed step.
 * `ask`: show the permission prompt; retries only check, so a "no" isn't asked again on every foreground.
 */
async function register(ask: boolean) {
  if (Platform.OS === 'android') {
    // Must match the worker's PUSH_STYLES. A channel's sound is fixed once created, so a new sound needs a new id.
    await step('channel', () =>
      Promise.all([
        Notifications.setNotificationChannelAsync('default', { name: 'Default', importance: Notifications.AndroidImportance.MAX }),
        Notifications.setNotificationChannelAsync('new-dropoff', {
          name: 'New drop offs',
          importance: Notifications.AndroidImportance.MAX,
          sound: 'dryyt.wav',
        }),
      ]),
    );
  }
  const permission = await step('permission', () => (ask ? Notifications.requestPermissionsAsync() : Notifications.getPermissionsAsync()));
  if (!permission.granted) {
    throw new RegistrationError('permission', `not granted (status ${permission.status}, canAskAgain ${permission.canAskAgain})`);
  }
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  if (!projectId) throw new RegistrationError('projectId', 'missing extra.eas.projectId in app config');
  const { data } = await step('getExpoPushTokenAsync', () => Notifications.getExpoPushTokenAsync({ projectId }));
  await step('save', () => api('/me/push-token', { body: { token: data } }));
}

/** Where a tap on a push lands, per role. */
function open(role: Role, id: number | null) {
  if (role === 'driver') return router.navigate('/driver');
  if (id === null) return;
  if (role === 'customer') router.push({ pathname: '/customer/dropoff/[id]', params: { id: String(id) } });
  else router.push({ pathname: '/owner/dropoff/[id]', params: { id: String(id) } });
}

/**
 * Push for the signed-in role: sends this device's Expo push token to the server, refreshes the affected data when
 * a push arrives with the app open, and opens the related screen when one is tapped (also from a cold start).
 * Registration retries each time the app returns to the foreground until it succeeds (e.g. after allowing
 * notifications in Settings); each distinct failure is reported to the worker log as `[push-token] failed`.
 */
export function usePushNotifications(role: Role) {
  const qc = useQueryClient();
  const tapped = Notifications.useLastNotificationResponse();

  useEffect(() => {
    let registered = false;
    let running = false;
    let asked = false;
    const reported = new Set<string>();

    const attempt = async () => {
      if (registered || running) return;
      running = true;
      try {
        const ask = !asked;
        asked = true;
        await register(ask);
        registered = true;
      } catch (err) {
        const { step: failed, message } = err instanceof RegistrationError ? err : new RegistrationError('save', String(err));
        if (__DEV__) console.warn(`[push-token] ${failed} failed: ${message}`);
        // Once per distinct failure, so a phone with notifications off doesn't log on every foreground.
        const key = `${failed}:${message}`;
        if (!reported.has(key)) {
          reported.add(key);
          api('/me/push-token/error', { body: { step: failed, error: message.slice(0, 500), platform: Platform.OS } }).catch(() => {});
        }
      } finally {
        running = false;
      }
    };

    attempt();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') attempt();
    });
    return () => sub.remove();
  }, []);

  // History is left alone: it loads at most once a minute, on focus or pull.
  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((n) => {
      const id = transactionOf(n);
      if (id !== null) qc.invalidateQueries({ queryKey: ['dropoff', id] });
      if (role === 'driver') qc.invalidateQueries({ queryKey: ['driver'] });
      if (role === 'owner') qc.invalidateQueries({ queryKey: ['owner'] });
    });
    return () => sub.remove();
  }, [qc, role]);

  useEffect(() => {
    if (!tapped || tapped.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    open(role, transactionOf(tapped.notification));
    // Handled once; otherwise a remount (e.g. sign out and back in) would open it again.
    Notifications.clearLastNotificationResponseAsync().catch(() => {});
  }, [tapped, role]);
}
