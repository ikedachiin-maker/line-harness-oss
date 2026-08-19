import { describe, expect, test } from 'vitest';
import { generateBulkSlots } from './bulk-slot-generator.js';

describe('generateBulkSlots', () => {
  test('weekly Mon/Wed 10:00-12:00 over a 2-week window', () => {
    const slots = generateBulkSlots({
      start_date: '2099-06-01', // Monday
      end_date: '2099-06-14',   // Sunday (2 weeks)
      weekdays: [1, 3],
      time_patterns: [{ start: '10:00', end: '12:00' }],
      capacity: 5,
    });
    expect(slots).toHaveLength(4);
    // First slot: 2099-06-01 10:00 JST = 2099-06-01 01:00 UTC
    expect(slots[0].starts_at).toBe('2099-06-01T01:00:00.000Z');
    expect(slots[0].ends_at).toBe('2099-06-01T03:00:00.000Z');
    expect(slots[0].capacity).toBe(5);
  });

  test('two time patterns generate multiple slots per matching day', () => {
    const slots = generateBulkSlots({
      start_date: '2099-06-01',
      end_date: '2099-06-01',
      weekdays: [1],
      time_patterns: [
        { start: '10:00', end: '11:00' },
        { start: '14:00', end: '15:00' },
      ],
      capacity: null,
    });
    expect(slots).toHaveLength(2);
    expect(slots[0].capacity).toBeNull();
    expect(slots[1].starts_at).toBe('2099-06-01T05:00:00.000Z');
  });

  test('returns empty when start > end', () => {
    expect(
      generateBulkSlots({
        start_date: '2099-06-10',
        end_date: '2099-06-01',
        weekdays: [1, 2, 3, 4, 5],
        time_patterns: [{ start: '10:00', end: '11:00' }],
        capacity: null,
      }),
    ).toEqual([]);
  });

  test('skips invalid time pattern (start >= end)', () => {
    const slots = generateBulkSlots({
      start_date: '2099-06-01',
      end_date: '2099-06-01',
      weekdays: [1],
      time_patterns: [
        { start: '10:00', end: '10:00' },
        { start: '14:00', end: '15:00' },
      ],
      capacity: null,
    });
    expect(slots).toHaveLength(1);
  });

  test('JST 23:00 -> 02:00 next-day translates to next-day UTC dates', () => {
    // 23:00 JST = 14:00 UTC same date
    const slots = generateBulkSlots({
      start_date: '2099-06-01',
      end_date: '2099-06-01',
      weekdays: [1],
      time_patterns: [{ start: '23:00', end: '23:30' }],
      capacity: 1,
    });
    expect(slots[0].starts_at).toBe('2099-06-01T14:00:00.000Z');
  });

  test('weekdays filter excludes non-matching days', () => {
    // 2099-06-01 (Mon) ... 2099-06-07 (Sun)
    const slots = generateBulkSlots({
      start_date: '2099-06-01',
      end_date: '2099-06-07',
      weekdays: [0, 6], // Sun + Sat
      time_patterns: [{ start: '10:00', end: '11:00' }],
      capacity: null,
    });
    // Only Saturday (06-06) and Sunday (06-07)
    expect(slots).toHaveLength(2);
  });
});
