import { useEffect, useState } from 'react';

function secondsLeft(until: number | null): number {
  return until === null ? 0 : Math.max(0, Math.ceil((until - Date.now()) / 1000));
}

/** Whole seconds remaining until `until` (epoch ms), re-rendering once a second. */
export function useCountdown(until: number | null): number {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (until === null) return undefined;
    const timer = window.setInterval(() => {
      setTick((count) => count + 1);
      if (secondsLeft(until) === 0) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [until]);
  return secondsLeft(until);
}

export function formatCountdown(totalSeconds: number): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${pad(minutes)}m`;
  if (minutes > 0) return `${minutes}m ${pad(seconds)}s`;
  return `${seconds}s`;
}
