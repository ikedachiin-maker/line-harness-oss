// Event booking shared types & constants.
// IDs are TEXT (UUID/nanoid) to follow line-harness schema.sql conventions.
// See: docs/superpowers/specs/2026-05-09-event-booking-design.md

export type EventBookingStatus =
  | 'requested'
  | 'confirmed'
  | 'rejected'
  | 'cancelled'
  | 'expired'
  | 'no_show'
  | 'attended';

export type CancelledBy = 'friend' | 'admin' | 'system';

export type EventReminderKind = 'day_before' | 'hours_before';

export type EventReminderStatus =
  | 'pending'
  | 'sent'
  | 'failed'
  | 'failed_permanent'
  | 'cancelled';

export type EventTargetType = 'single' | 'multi-account-dedup';

export const EVENT_TARGET_TYPES: ReadonlyArray<EventTargetType> = ['single', 'multi-account-dedup'];

export interface EventRow {
  id: string;
  line_account_id: string;
  name: string;
  venue_name: string | null;
  venue_url: string | null;
  image_url: string | null;
  description: string | null;
  description_centered: number;
  max_bookings_per_friend: number | null;
  requires_approval: number;
  cancel_deadline_hours_before: number | null;
  reminder_day_before_enabled: number;
  reminder_hours_before: number | null;
  is_published: number;
  folder_id: string | null;
  sort_order: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  // Multi-account fields (migration 040). broadcasts と同パターン:
  //   - target_type='single' のとき line_account_id 必須、account_ids/dedup_priority は NULL
  //   - target_type='multi-account-dedup' のとき account_ids 必須 (JSON 配列文字列)、
  //     line_account_id は account_ids[0] を sentinel として保持
  target_type: EventTargetType;
  account_ids: string | null;
  dedup_priority: string | null;
  failed_account_ids: string | null;
}

export interface EventSlotRow {
  id: string;
  event_id: string;
  starts_at: string;
  ends_at: string;
  capacity: number | null;
  is_active: number;
  sort_order: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EventBookingRow {
  id: string;
  line_account_id: string;
  event_id: string;
  slot_id: string;
  friend_id: string;
  status: EventBookingStatus;
  customer_note: string | null;
  internal_note: string | null;
  requested_at: string;
  decided_at: string | null;
  decided_by_staff_id: string | null;
  cancelled_at: string | null;
  cancelled_by: CancelledBy | null;
  created_at: string;
  updated_at: string;
}

export interface EventBookingReminderRow {
  id: string;
  booking_id: string;
  kind: EventReminderKind;
  scheduled_at: string;
  sent_at: string | null;
  status: EventReminderStatus;
  retry_count: number;
  last_error: string | null;
}

export const EVENT_NAME_MAX = 255;
export const EVENT_DESCRIPTION_MAX = 20000;
export const CUSTOMER_NOTE_MAX = 5000;
export const REQUESTED_EXPIRE_HOURS = 24;
export const REMINDER_MAX_RETRY = 3;
export const EVENT_IDEMPOTENCY_TTL_MINUTES = 60 * 24;

export const ACTIVE_BOOKING_STATUSES: ReadonlyArray<EventBookingStatus> = [
  'requested',
  'confirmed',
];
