// 💤 מזהה שהמחשב ישן: טיימר שאמור לתקתק כל 15 שניות. אם עבר הרבה יותר, המחשב היה בשינה.
/**
 * @param {{ onWake: (gap: {from: number, to: number, ms: number}) => void, intervalMs?: number, thresholdMs?: number, now?: () => number, setIntervalFn?: Function }} opts
 */
export function createWakeWatcher({ onWake, intervalMs = 15_000, thresholdMs = 60_000, now = Date.now, setIntervalFn = setInterval }) {
  let last = now();
  const tick = () => {
    const t = now();
    const gap = t - last;
    last = t;
    if (gap > thresholdMs) onWake({ from: t - gap, to: t, ms: gap });
  };
  const handle = setIntervalFn(tick, intervalMs);
  return { tick, stop: () => clearInterval(handle) };
}
