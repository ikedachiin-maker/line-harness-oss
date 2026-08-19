import type { EventBookingStatus } from './event-booking-types.js';

export type EventBookingAction =
  | 'confirm'
  | 'reject'
  | 'expire'
  | 'cancel'
  | 'mark_attended'
  | 'mark_no_show';

const TRANSITIONS: Record<EventBookingStatus, Partial<Record<EventBookingAction, EventBookingStatus>>> = {
  requested: { confirm: 'confirmed', reject: 'rejected', expire: 'expired', cancel: 'cancelled' },
  confirmed: { cancel: 'cancelled', mark_attended: 'attended', mark_no_show: 'no_show' },
  rejected: {},
  expired: {},
  cancelled: {},
  attended: {},
  no_show: {},
};

export function canTransition(from: EventBookingStatus, action: EventBookingAction): boolean {
  return TRANSITIONS[from][action] !== undefined;
}

export function nextStatus(from: EventBookingStatus, action: EventBookingAction): EventBookingStatus {
  const next = TRANSITIONS[from][action];
  if (!next) {
    throw new Error(`Invalid transition: ${from} via ${action}`);
  }
  return next;
}

export function transitionsFrom(from: EventBookingStatus): EventBookingAction[] {
  return Object.keys(TRANSITIONS[from]) as EventBookingAction[];
}
