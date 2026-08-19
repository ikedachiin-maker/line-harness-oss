-- packages/db/migrations/041_event_custom_messages.sql
-- イベント単位のカスタム追記メッセージ。
-- confirmation_message_extra: 予約確定通知 (received_confirmed, confirmed) の末尾に追記
-- reminder_message_extra:    リマインド通知 (reminder_day_before, reminder_hours_before) の末尾に追記
-- どちらも NULL = 追記なし（既存挙動と同じ）。

ALTER TABLE events ADD COLUMN confirmation_message_extra TEXT;
ALTER TABLE events ADD COLUMN reminder_message_extra TEXT;
