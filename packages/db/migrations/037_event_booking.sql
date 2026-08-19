-- Migration 037: Event Booking (Phase 1)
-- See: docs/superpowers/specs/2026-05-09-event-booking-design.md
--
-- Conventions follow 036_booking.sql: TEXT (UUID/nanoid) primary keys,
-- created_at/updated_at default in JST. Time-of-event columns
-- (starts_at / ends_at / requested_at / scheduled_at / sent_at /
-- decided_at / cancelled_at / expires_at) are written by the Worker as
-- UTC ISO8601 (Z-suffixed) and have NO default — callers must provide them.

-- ============================================================
-- events: イベントマスタ
-- ============================================================
CREATE TABLE IF NOT EXISTS events (
  id                            TEXT PRIMARY KEY,
  line_account_id               TEXT NOT NULL,
  name                          TEXT NOT NULL,
  venue_name                    TEXT,
  venue_url                     TEXT,
  image_url                     TEXT,
  description                   TEXT,
  description_centered          INTEGER NOT NULL DEFAULT 0,
  max_bookings_per_friend       INTEGER,
  requires_approval             INTEGER NOT NULL DEFAULT 0,
  cancel_deadline_hours_before  INTEGER,
  reminder_day_before_enabled   INTEGER NOT NULL DEFAULT 1,
  reminder_hours_before         INTEGER,
  is_published                  INTEGER NOT NULL DEFAULT 0,
  folder_id                     TEXT,
  sort_order                    INTEGER NOT NULL DEFAULT 0,
  deleted_at                    TEXT,
  created_at                    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at                    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  FOREIGN KEY (line_account_id) REFERENCES line_accounts(id)
);
CREATE INDEX IF NOT EXISTS idx_events_account_published_sort ON events (line_account_id, is_published, sort_order);

-- ============================================================
-- event_slots: 予約枠
-- ============================================================
CREATE TABLE IF NOT EXISTS event_slots (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL,
  starts_at   TEXT NOT NULL,
  ends_at     TEXT NOT NULL,
  capacity    INTEGER,
  is_active   INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  deleted_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  FOREIGN KEY (event_id) REFERENCES events(id)
);
CREATE INDEX IF NOT EXISTS idx_event_slots_event_starts ON event_slots (event_id, starts_at);

-- ============================================================
-- event_bookings: イベント予約
-- ============================================================
CREATE TABLE IF NOT EXISTS event_bookings (
  id                    TEXT PRIMARY KEY,
  line_account_id       TEXT NOT NULL,
  event_id              TEXT NOT NULL,
  slot_id               TEXT NOT NULL,
  friend_id             TEXT NOT NULL,
  status                TEXT NOT NULL CHECK (status IN ('requested','confirmed','rejected','cancelled','expired','no_show','attended')),
  customer_note         TEXT,
  internal_note         TEXT,
  requested_at          TEXT NOT NULL,
  decided_at            TEXT,
  decided_by_staff_id   TEXT,
  cancelled_at          TEXT,
  cancelled_by          TEXT CHECK (cancelled_by IN ('friend','admin','system')),
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  FOREIGN KEY (line_account_id) REFERENCES line_accounts(id),
  FOREIGN KEY (event_id) REFERENCES events(id),
  FOREIGN KEY (slot_id) REFERENCES event_slots(id),
  FOREIGN KEY (friend_id) REFERENCES friends(id)
);
CREATE INDEX IF NOT EXISTS idx_event_bookings_account_status_event ON event_bookings (line_account_id, status, event_id);
CREATE INDEX IF NOT EXISTS idx_event_bookings_slot_status ON event_bookings (slot_id, status);
CREATE INDEX IF NOT EXISTS idx_event_bookings_friend_requested ON event_bookings (friend_id, requested_at DESC);

-- ============================================================
-- event_booking_reminders: 前日 / 開始 N 時間前リマインダ
-- ============================================================
CREATE TABLE IF NOT EXISTS event_booking_reminders (
  id            TEXT PRIMARY KEY,
  booking_id    TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('day_before','hours_before')),
  scheduled_at  TEXT NOT NULL,
  sent_at       TEXT,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','failed_permanent','cancelled')),
  retry_count   INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  FOREIGN KEY (booking_id) REFERENCES event_bookings(id)
);
CREATE INDEX IF NOT EXISTS idx_event_booking_reminders_status_scheduled ON event_booking_reminders (status, scheduled_at);

-- ============================================================
-- event_booking_idempotency_keys: LIFF 多重送信防止
-- ============================================================
CREATE TABLE IF NOT EXISTS event_booking_idempotency_keys (
  key              TEXT PRIMARY KEY,
  line_account_id  TEXT NOT NULL,
  friend_id        TEXT NOT NULL,
  response_status  INTEGER NOT NULL,
  response_body    TEXT NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  expires_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_event_booking_idempotency_expires ON event_booking_idempotency_keys (expires_at);
