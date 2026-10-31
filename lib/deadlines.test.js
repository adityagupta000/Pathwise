import { describe, it, expect } from 'vitest';
import {
  todayInTimezone,
  computeDeadlineDays,
  computeDeadlineStatus,
  sampleDates,
} from './deadlines.js';

describe('lib/deadlines.js', () => {
  describe('computeDeadlineDays', () => {
    it('computes 5 days in future → 5', () => {
      const now = new Date('2025-05-10T10:00:00Z');
      expect(computeDeadlineDays('2025-05-15', now, 'UTC')).toBe(5);
    });

    it('computes yesterday → -1', () => {
      const now = new Date('2025-05-10T10:00:00Z');
      expect(computeDeadlineDays('2025-05-09', now, 'UTC')).toBe(-1);
    });

    it('computes today → 0', () => {
      const now = new Date('2025-05-10T10:00:00Z');
      expect(computeDeadlineDays('2025-05-10', now, 'UTC')).toBe(0);
    });

    it('UTC midnight boundary: when 23:30 UTC (= 05:00 IST next day) uses IST date not UTC date', () => {
      // 2025-05-10 23:30 UTC is 2025-05-11 05:00 IST
      const now = new Date('2025-05-10T23:30:00Z');
      // For IST, today is 2025-05-11.
      // So deadline 2025-05-11 is today (0), while in UTC it would be tomorrow (1).
      expect(computeDeadlineDays('2025-05-11', now, 'Asia/Kolkata')).toBe(0);
      expect(computeDeadlineDays('2025-05-11', now, 'UTC')).toBe(1);
    });

    it('handles invalid inputs: falsy, not ISO YYYY-MM-DD, implausible year, invalid date', () => {
      const now = new Date('2025-05-10T10:00:00Z');
      expect(computeDeadlineDays(null, now)).toBeNull();
      expect(computeDeadlineDays('', now)).toBeNull();
      expect(computeDeadlineDays('invalid-date', now)).toBeNull();
      expect(computeDeadlineDays('10-05-2025', now)).toBeNull();
      // Year too far (now is 2025, 2010 is -15 years, 2035 is +10 years)
      expect(computeDeadlineDays('2015-05-10', now)).toBeNull();
      expect(computeDeadlineDays('2035-05-10', now)).toBeNull();
      // Invalid calendar date: Feb 30
      expect(computeDeadlineDays('2025-02-30', now)).toBeNull();
      expect(computeDeadlineDays('2025-04-31', now)).toBeNull();
    });
  });

  describe('computeDeadlineStatus', () => {
    it('-3 → overdue', () => {
      expect(computeDeadlineStatus(-3)).toBe('overdue');
    });

    it('0 → due_today', () => {
      expect(computeDeadlineStatus(0)).toBe('due_today');
    });

    it('5 → upcoming', () => {
      expect(computeDeadlineStatus(5)).toBe('upcoming');
    });

    it('relative_unanchored flag → relative_unanchored', () => {
      expect(computeDeadlineStatus(null, true)).toBe('relative_unanchored');
      expect(computeDeadlineStatus(5, true)).toBe('relative_unanchored');
    });

    it('null or undefined → unknown', () => {
      expect(computeDeadlineStatus(null)).toBe('unknown');
      expect(computeDeadlineStatus(undefined)).toBe('unknown');
    });
  });

  describe('sampleDates', () => {
    it('never returns a past date', () => {
      const { submissionDate, appointmentDate } = sampleDates(5);
      const today = todayInTimezone('Asia/Kolkata');
      expect(submissionDate).toBe(today);
      expect(appointmentDate >= submissionDate).toBe(true);
    });
  });
});

