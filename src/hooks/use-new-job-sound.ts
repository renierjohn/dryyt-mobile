import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { useEffect, useRef } from 'react';

const SOUND = require('@/assets/audio/dryyt.mp3');

/**
 * Plays the Dryyt chime when `ids` gains a job the driver hasn't seen yet, including jobs already
 * waiting when the list first loads; never twice for the same job. Foreground only: the app must be open.
 */
export function useNewJobSound(ids: string[], enabled = true) {
  const player = useAudioPlayer(SOUND);
  const seen = useRef(new Set<string>());
  const key = ids.join(',');

  useEffect(() => {
    // Ring even with the phone on silent, ducking other audio briefly.
    setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'duckOthers' }).catch(() => {});
  }, []);

  useEffect(() => {
    const current = key ? key.split(',') : [];
    const fresh = current.filter((id) => !seen.current.has(id));
    current.forEach((id) => seen.current.add(id));
    if (enabled && fresh.length > 0) {
      player.seekTo(0);
      player.play();
    }
  }, [key, enabled, player]);
}
