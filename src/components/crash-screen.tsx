import type { ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import { Button } from '@/components/button';
import { ErrorText } from '@/components/error-text';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';

/** Shown instead of a blank screen when rendering throws. */
export function CrashScreen({ error, retry }: ErrorBoundaryProps) {
  // The root layout normally hides the splash; if it crashed, nothing else will.
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
    console.error(error);
  }, [error]);

  return (
    <Screen>
      <ThemedText type="subtitle">Something went wrong</ThemedText>
      <ThemedText themeColor="textSecondary">The app hit an unexpected error. Try again, or restart the app if it keeps happening.</ThemedText>
      <ErrorText error={error} />
      <Button title="Try again" onPress={retry} />
    </Screen>
  );
}
