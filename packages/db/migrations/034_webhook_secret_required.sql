-- Issue #103: Webhook secret を必須化 (最低 32 文字) し、secret 未設定の
-- 既存 webhook を fail-closed で無効化する。secret 必須化は API 層で
-- enforce するが、過去に secret なしで作成済みのレコードを残すと
-- イベント偽造リスクが残るため、ここで is_active = 0 に強制する。
-- secret を設定し直したうえで管理画面から再有効化してもらう運用に切り替える。

UPDATE incoming_webhooks
   SET is_active = 0,
       updated_at = strftime('%Y-%m-%dT%H:%M:%S', 'now', '+9 hours') || '.000+09:00'
 WHERE secret IS NULL
    OR LENGTH(secret) < 32;

UPDATE outgoing_webhooks
   SET is_active = 0,
       updated_at = strftime('%Y-%m-%dT%H:%M:%S', 'now', '+9 hours') || '.000+09:00'
 WHERE secret IS NULL
    OR LENGTH(secret) < 32
    OR url IS NULL
    -- Require https:// + a non-empty host that does not start with a meta
    -- character. Catches schema-only and obviously-malformed values like
    -- 'https://', 'https://:443', 'https://?foo', 'https://#x' that the
    -- runtime URL validator rejects but a naive `LIKE 'https://_%'` accepts.
    -- Edge cases that slip through here are still fail-closed at the API
    -- (PUT activation gate) and at delivery time (validateHttpsUrl).
    OR url NOT LIKE 'https://_%'
    OR url LIKE 'https://:%'
    OR url LIKE 'https://?%'
    OR url LIKE 'https://#%'
    OR url LIKE 'https://[%';
