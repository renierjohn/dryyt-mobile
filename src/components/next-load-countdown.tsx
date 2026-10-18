import { useEffect, useState } from 'react';

import { ThemedText } from '@/components/themed-text';

/** Seconds until `at` (epoch ms), when a list may load again; `label` names the list, e.g. "/history". */
export function NextLoadCountdown({ at, label }: { at: number; label: string }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const left = Math.max(0, Math.ceil((at - now) / 1000));
  return (
    <ThemedText type="small" themeColor="textSecondary">
      [dev] {label} {left > 0 ? `refresh in ${left}s` : 'refreshes on focus or pull'}
    </ThemedText>
  );
}
