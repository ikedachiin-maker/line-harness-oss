import type { BookingStatus } from './booking-types.js';

export type BookingAction =
  | 'approve'
  | 'reject'
  | 'expire'
  | 'cancel'
  | 'complete'
  | 'no_show';

const TRANSITIONS: Record<BookingStatus, Partial<Record<BookingAction, BookingStatus>>> = {
  requested: { approve: 'confirmed', reject: 'rejected', expire: 'expired' },
  confirmed: { cancel: 'cancelled', no_show: 'no_show', complete: 'completed' },
  rejected: {},
  expired: {},
  cancelled: {},
  completed: {},
  no_show: {},
};

export function canTransition(from: BookingStatus, action: BookingAction): boolean {
  return TRANSITIONS[from][action] !== undefined;
}

export function nextStatus(from: BookingStatus, action: BookingAction): BookingStatus {
  const next = TRANSITIONS[from][action];
  if (!next) {
    throw new Error(`Invalid transition: ${from} via ${action}`);
  }
  return next;
}

export function transitionsFrom(from: BookingStatus): BookingAction[] {
  return Object.keys(TRANSITIONS[from]) as BookingAction[];
}
