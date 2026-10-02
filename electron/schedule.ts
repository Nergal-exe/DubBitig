import type { BackupPeriod } from '../src/shared/model.js';

// Calendar-based schedules retain local time and clamp month ends (Jan 31 -> Feb 28).
export function advanceDate(value: string, period: Exclude<BackupPeriod, '30m'> | '30m', anchorDay?: number) {
  const d = new Date(value);
  if (period === 'monthly') { const day = anchorDay ?? d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + 1); const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); d.setDate(Math.min(day, last)); }
  else if (period === 'weekly') d.setDate(d.getDate() + 7);
  else if (period === 'daily') d.setDate(d.getDate() + 1);
  else d.setMinutes(d.getMinutes() + 30);
  return d.toISOString();
}
export function nextReminder(at: string, repeat: 'daily' | 'weekly' | 'monthly', now: Date, anchorDay = new Date(at).getDate()) {
  let next = at;
  // Skip missed occurrences without producing a burst of notifications.
  while (new Date(next) <= now) next = advanceDate(next, repeat, anchorDay);
  return next;
}
