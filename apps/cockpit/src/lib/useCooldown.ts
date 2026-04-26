import { useEffect, useState } from 'react';

// Returns 0 → 1 indicating how much of the cooldown has elapsed.
// 0 = just started, 1 = expired. null when no cooldown applies.
// Tick interval is 250ms — smooth enough for a thin progress bar without
// burning render budget. Stops ticking once it hits 1.
export function useCooldown(createdAtIso: string, expiresAtIso: string | null): number | null {
  const [progress, setProgress] = useState<number | null>(() =>
    computeProgress(createdAtIso, expiresAtIso),
  );

  useEffect(() => {
    if (!expiresAtIso) {
      setProgress(null);
      return;
    }
    const tick = () => {
      const p = computeProgress(createdAtIso, expiresAtIso);
      setProgress(p);
      if (p !== null && p < 1) {
        return;
      }
      // Already expired — stop the loop.
      window.clearInterval(handle);
    };
    const handle = window.setInterval(tick, 250);
    tick();
    return () => window.clearInterval(handle);
  }, [createdAtIso, expiresAtIso]);

  return progress;
}

function computeProgress(createdAtIso: string, expiresAtIso: string | null): number | null {
  if (!expiresAtIso) return null;
  const start = Date.parse(createdAtIso);
  const end = Date.parse(expiresAtIso);
  const now = Date.now();
  const total = end - start;
  if (total <= 0) return 1;
  const elapsed = now - start;
  if (elapsed <= 0) return 0;
  if (elapsed >= total) return 1;
  return elapsed / total;
}
