import { describe, it, expect } from 'vitest';
import { buildSummaryText } from './summary.js';

describe('buildSummaryText', () => {
  it('formats overdue deadline', () => {
    const prioritized = [
      {
        required_action: 'Pay Outstanding Tax Demand',
        deadline_status: 'overdue',
        deadline_days: -5,
        deadline_text: 'Within 30 days',
      },
    ];
    const text = buildSummaryText(prioritized);
    expect(text).toContain('Deadline: OVERDUE by 5 days.');
  });

  it('formats due_today deadline', () => {
    const prioritized = [
      {
        required_action: 'Submit Biometric Authentication',
        deadline_status: 'due_today',
        deadline_days: 0,
        deadline_date: '2026-10-31',
      },
    ];
    const text = buildSummaryText(prioritized);
    expect(text).toContain('Deadline: Due TODAY.');
  });

  it('formats relative_unanchored deadline verbatim without numeric countdown', () => {
    const prioritized = [
      {
        required_action: 'Appear for Document Verification',
        deadline_status: 'relative_unanchored',
        deadline_days: null,
        deadline_text: 'within 10 days of receipt of this notice',
      },
    ];
    const text = buildSummaryText(prioritized);
    expect(text).toContain('Deadline: within 10 days of receipt of this notice.');
    expect(text).not.toContain('days left');
  });

  it('formats upcoming deadline with date', () => {
    const prioritized = [
      {
        required_action: 'Submit KYC Documents',
        deadline_status: 'upcoming',
        deadline_days: 7,
        deadline_date: '2026-11-07',
      },
    ];
    const text = buildSummaryText(prioritized);
    expect(text).toContain('Deadline: Due in 7 days (2026-11-07).');
  });

  it('formats unknown deadline as No deadline specified', () => {
    const prioritized = [
      {
        required_action: 'Optional Survey Form',
        deadline_status: 'unknown',
        deadline_days: null,
      },
    ];
    const text = buildSummaryText(prioritized);
    expect(text).toContain('Deadline: No deadline specified.');
  });

  it('renders estimated_time_minutes when present', () => {
    const prioritized = [
      {
        required_action: 'Update Aadhaar Phone',
        deadline_status: 'unknown',
        estimated_time_minutes: 25,
      },
    ];
    const text = buildSummaryText(prioritized);
    expect(text).toContain('Estimated time: ~25 minutes.');
  });
});
