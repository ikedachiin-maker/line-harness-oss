import { describe, expect, test } from 'vitest';
import { canTransition, nextStatus, transitionsFrom, type BookingAction } from './booking-state.js';

describe('canTransition', () => {
  test('requested → confirmed via approve', () => {
    expect(canTransition('requested', 'approve')).toBe(true);
  });
  test('requested → rejected via reject', () => {
    expect(canTransition('requested', 'reject')).toBe(true);
  });
  test('requested → expired via expire', () => {
    expect(canTransition('requested', 'expire')).toBe(true);
  });
  test('confirmed → cancelled via cancel', () => {
    expect(canTransition('confirmed', 'cancel')).toBe(true);
  });
  test('confirmed → no_show via no_show', () => {
    expect(canTransition('confirmed', 'no_show')).toBe(true);
  });
  test('confirmed → completed via complete', () => {
    expect(canTransition('confirmed', 'complete')).toBe(true);
  });
  test('rejected → confirmed: forbidden', () => {
    expect(canTransition('rejected', 'approve')).toBe(false);
  });
  test('completed → cancelled: forbidden', () => {
    expect(canTransition('completed', 'cancel')).toBe(false);
  });
  test('expired → confirmed: forbidden', () => {
    expect(canTransition('expired', 'approve')).toBe(false);
  });
  test('cancelled is terminal', () => {
    expect(canTransition('cancelled', 'approve')).toBe(false);
    expect(canTransition('cancelled', 'cancel')).toBe(false);
  });
});

describe('nextStatus', () => {
  test('returns correct next state for valid transition', () => {
    expect(nextStatus('requested', 'approve')).toBe('confirmed');
    expect(nextStatus('confirmed', 'cancel')).toBe('cancelled');
  });
  test('throws for invalid transition', () => {
    expect(() => nextStatus('rejected', 'approve')).toThrow(/Invalid transition/);
  });
});

describe('transitionsFrom', () => {
  test('requested allows approve / reject / expire', () => {
    const actions: BookingAction[] = transitionsFrom('requested');
    expect(actions.sort()).toEqual(['approve', 'expire', 'reject']);
  });
  test('confirmed allows cancel / complete / no_show', () => {
    const actions = transitionsFrom('confirmed');
    expect(actions.sort()).toEqual(['cancel', 'complete', 'no_show']);
  });
  test('terminal states return empty array', () => {
    expect(transitionsFrom('rejected')).toEqual([]);
    expect(transitionsFrom('expired')).toEqual([]);
    expect(transitionsFrom('cancelled')).toEqual([]);
    expect(transitionsFrom('completed')).toEqual([]);
    expect(transitionsFrom('no_show')).toEqual([]);
  });
});
