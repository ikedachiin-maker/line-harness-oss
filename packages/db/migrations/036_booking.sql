-- Migration 036: Booking feature (Phase 1)
-- See: docs/superpowers/specs/2026-05-08-booking-design.md
--
-- Conventions follow schema.sql: TEXT (UUID/nanoid) primary keys,
-- created_at default in JST. Time-of-event columns (starts_at / ends_at /
-- block_ends_at / requested_at / scheduled_at / sent_at / decided_at /
-- expires_at) are written by the Worker as UTC ISO8601 (Z-suffixed) and
-- have NO default — callers must provide them.

-- ============================================================
-- menus: メニューマスタ
-- ============================================================
CREATE TABLE IF NOT EXISTS menus (
  id                    TEXT PRIMARY KEY,
  line_account_id       TEXT NOT NULL,
  name                  TEXT NOT NULL,
  category_label        TEXT,
  description           TEXT,
  duration_minutes      INTEGER NOT NULL,
  buffer_after_minutes  INTEGER NOT NULL DEFAULT 0,
  base_price            INTEGER NOT NULL,
  sort_order            INTEGER NOT NULL DEFAULT 0,
  is_active             INTEGER NOT NULL DEFAULT 1,
  deleted_at            TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  FOREIGN KEY (line_account_id) REFERENCES line_accounts(id)
);
CREATE INDEX IF NOT EXISTS idx_menus_account_sort ON menus (line_account_id, sort_order);

-- ============================================================
-- staff: スタッフ
-- ============================================================
CREATE TABLE IF NOT EXISTS staff (
  id                       TEXT PRIMARY KEY,
  line_account_id          TEXT NOT NULL,
  name                     TEXT NOT NULL,
  display_name             TEXT NOT NULL,
  role                     TEXT,
  profile_image_url        TEXT,
  bio                      TEXT,
  sort_order               INTEGER NOT NULL DEFAULT 0,
  is_designation_optional  INTEGER NOT NULL DEFAULT 0,
  is_active                INTEGER NOT NULL DEFAULT 1,
  deleted_at               TEXT,
  created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  FOREIGN KEY (line_account_id) REFERENCES line_accounts(id)
);
CREATE INDEX IF NOT EXISTS idx_staff_account_sort ON staff (line_account_id, sort_order);

-- ============================================================
-- staff_menus: スタッフ x メニュー (提供可否・上書き値)
-- ============================================================
CREATE TABLE IF NOT EXISTS staff_menus (
  staff_id                  TEXT NOT NULL,
  menu_id                   TEXT NOT NULL,
  is_offered                INTEGER NOT NULL DEFAULT 1,
  override_duration_minutes INTEGER,
  override_price            INTEGER,
  PRIMARY KEY (staff_id, menu_id),
  FOREIGN KEY (staff_id) REFERENCES staff(id),
  FOREIGN KEY (menu_id) REFERENCES menus(id)
);

-- ============================================================
-- staff_shifts: シフト (レコードなし = その日休み)
-- ============================================================
CREATE TABLE IF NOT EXISTS staff_shifts (
  id          TEXT PRIMARY KEY,
  staff_id    TEXT NOT NULL,
  work_date   TEXT NOT NULL,    -- YYYY-MM-DD (JST)
  start_time  TEXT NOT NULL,    -- HH:MM (JST)
  end_time    TEXT NOT NULL,    -- HH:MM (JST)
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (staff_id, work_date),
  FOREIGN KEY (staff_id) REFERENCES staff(id)
);
CREATE INDEX IF NOT EXISTS idx_shifts_staff_date ON staff_shifts (staff_id, work_date);

-- ============================================================
-- bookings: 予約本体
-- ============================================================
CREATE TABLE IF NOT EXISTS bookings (
  id                      TEXT PRIMARY KEY,
  line_account_id         TEXT NOT NULL,
  friend_id               TEXT NOT NULL,        -- friends.id
  staff_id                TEXT NOT NULL,
  menu_id                 TEXT NOT NULL,
  starts_at               TEXT NOT NULL,        -- UTC ISO8601 (Z)
  ends_at                 TEXT NOT NULL,        -- UTC ISO8601 (Z)
  block_ends_at           TEXT NOT NULL,        -- ends_at + buffer_after。衝突判定
  status                  TEXT NOT NULL CHECK (status IN ('requested','confirmed','rejected','expired','cancelled','completed','no_show')),
  customer_note           TEXT,
  internal_note           TEXT,
  price_at_booking        INTEGER NOT NULL,
  requested_at            TEXT NOT NULL,        -- UTC ISO8601
  decided_at              TEXT,                 -- UTC ISO8601
  decided_by_staff_id     TEXT,
  external_event_id       TEXT,                 -- Phase 3 余地 (Google Calendar)
  external_calendar_id    TEXT,                 -- Phase 3 余地
  created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  FOREIGN KEY (line_account_id) REFERENCES line_accounts(id),
  FOREIGN KEY (friend_id) REFERENCES friends(id),
  FOREIGN KEY (staff_id) REFERENCES staff(id),
  FOREIGN KEY (menu_id) REFERENCES menus(id)
);
CREATE INDEX IF NOT EXISTS idx_bookings_account_status_starts ON bookings (line_account_id, status, starts_at);
CREATE INDEX IF NOT EXISTS idx_bookings_staff_overlap ON bookings (staff_id, status, starts_at, block_ends_at);
CREATE INDEX IF NOT EXISTS idx_bookings_friend_starts ON bookings (friend_id, starts_at DESC);

-- ============================================================
-- booking_idempotency_keys: LIFF 多重送信防止
-- ============================================================
CREATE TABLE IF NOT EXISTS booking_idempotency_keys (
  key              TEXT PRIMARY KEY,
  line_account_id  TEXT NOT NULL,
  friend_id        TEXT NOT NULL,
  response_status  INTEGER NOT NULL,
  response_body    TEXT NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  expires_at       TEXT NOT NULL                  -- UTC ISO8601
);
CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON booking_idempotency_keys (expires_at);

-- ============================================================
-- booking_reminders: 前日 / 当日 N 時間前リマインダ
-- ============================================================
CREATE TABLE IF NOT EXISTS booking_reminders (
  id            TEXT PRIMARY KEY,
  booking_id    TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('day_before','hours_before')),
  scheduled_at  TEXT NOT NULL,                                -- UTC ISO8601
  sent_at       TEXT,                                         -- UTC ISO8601
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','failed_permanent','cancelled')),
  retry_count   INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  FOREIGN KEY (booking_id) REFERENCES bookings(id)
);
CREATE INDEX IF NOT EXISTS idx_reminders_status_scheduled ON booking_reminders (status, scheduled_at);
