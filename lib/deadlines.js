// lib/deadlines.js — server-side deadline computation (no LLM date maths).

const DEFAULT_TIMEZONE = 'Asia/Kolkata';

/**
 * Return today's date string YYYY-MM-DD in the given IANA timezone.
 * Uses Intl.DateTimeFormat which is available in Node 18+.
 */
export function todayInTimezone(timezone = process.env.APP_TIMEZONE || DEFAULT_TIMEZONE, now = new Date()) {
  // en-CA locale gives YYYY-MM-DD format
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/**
 * Compute whole calendar-day difference between deadlineDate and today.
 * Returns null if deadlineDate is falsy, not ISO YYYY-MM-DD, or year is implausible.
 */
export function computeDeadlineDays(deadlineDateIso, now = new Date(), timezone = process.env.APP_TIMEZONE || DEFAULT_TIMEZONE) {
  if (!deadlineDateIso || typeof deadlineDateIso !== 'string') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deadlineDateIso)) return null;
  const [y, m, d] = deadlineDateIso.split('-').map(Number);
  // Reject implausible years (±5 from today)
  const nowYear = now.getFullYear();
  if (y < nowYear - 5 || y > nowYear + 5) return null;
  // Validate it's a real calendar date
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;

  const todayStr = todayInTimezone(timezone, now);
  const [ty, tm, td] = todayStr.split('-').map(Number);
  const deadlineMs = Date.UTC(y, m - 1, d);
  const todayMs = Date.UTC(ty, tm - 1, td);
  return Math.round((deadlineMs - todayMs) / 86_400_000);
}

/**
 * Compute a human status from deadline_days and whether this is a relative-unanchored deadline.
 * @param {number|null} deadlineDays
 * @param {boolean} isRelativeUnanchored - true when deadline_date is null but deadline_relative_days is set
 * @returns {'overdue'|'due_today'|'upcoming'|'relative_unanchored'|'unknown'}
 */
export function computeDeadlineStatus(deadlineDays, isRelativeUnanchored = false) {
  if (isRelativeUnanchored) return 'relative_unanchored';
  if (deadlineDays === null || deadlineDays === undefined) return 'unknown';
  if (deadlineDays < 0) return 'overdue';
  if (deadlineDays === 0) return 'due_today';
  return 'upcoming';
}

/**
 * Generate sample document dates relative to today so the demo is always meaningful.
 * Returns { submissionDate, appointmentDate } as locale strings.
 */
export function sampleDates(daysFromNow = 5, timezone = process.env.APP_TIMEZONE || DEFAULT_TIMEZONE) {
  const now = new Date();
  const apptDate = new Date(now);
  apptDate.setDate(apptDate.getDate() + daysFromNow);
  return {
    submissionDate: todayInTimezone(timezone, now),
    appointmentDate: todayInTimezone(timezone, apptDate),
  };
}
