import { Hono } from 'hono';
import {
  getAudienceOverview,
  getAudienceHistory,
  recordAudienceSnapshot,
  countLineFriendsByAccount,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { collectAudience, harnessSourcesFromEnv } from '../services/audience-collector.js';

/**
 * Audience — メルマガ読者数・LINE友だち数・SNSフォロワー数を1画面で見る。
 *
 * 名簿は各チャネル (と UTAGE) に置いたまま、人数だけをここに集める。
 * 詳細は packages/db/migrations/071_audience_snapshots.sql。
 */
const audience = new Hono<Env>();

// GET /api/audience — この harness 自身の人数。
//
// 他のハーネスから poll されるのがこのエンドポイントで、5本すべて同じ形を返す。
// line-harness 自身も同じ形で答えるので、複数台を横に並べたときもそのまま繋がる。
audience.get('/api/audience', async (c) => {
  try {
    const accounts = await countLineFriendsByAccount(c.env.DB);
    return c.json({
      success: true,
      data: {
        channel: 'line',
        accounts: accounts.map((a) => ({
          key: a.accountKey,
          label: a.accountLabel,
          total: a.total,
        })),
      },
    });
  } catch (err) {
    console.error('GET /api/audience error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/audience/overview — 全チャネルまとめ (管理画面が読む)
audience.get('/api/audience/overview', async (c) => {
  try {
    return c.json({ success: true, data: await getAudienceOverview(c.env.DB) });
  } catch (err) {
    console.error('GET /api/audience/overview error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/audience/history?channel=&accountKey=&days=
audience.get('/api/audience/history', async (c) => {
  try {
    const channel = c.req.query('channel');
    if (!channel) return c.json({ success: false, error: 'channel is required' }, 400);

    const rawDays = Number(c.req.query('days') ?? 90);
    // 上限を切らないと1系列で数千行返しうる。グラフに要る範囲だけ許す。
    const days = Number.isFinite(rawDays) ? Math.min(Math.max(Math.trunc(rawDays), 1), 365) : 90;

    const rows = await getAudienceHistory(c.env.DB, {
      channel,
      accountKey: c.req.query('accountKey') || undefined,
      days,
    });
    return c.json({ success: true, data: rows });
  } catch (err) {
    console.error('GET /api/audience/history error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/**
 * POST /api/audience/report — 外から人数を送り込む。
 *
 * poll できない相手のための口。UTAGE のメルマガ読者数がこれで入る
 * (UTAGE の API キーは ikeda-os 側にあるので、あちらが読んで送る)。
 *
 * capturedOn を指定できるので、過去日の取りこぼしを後から埋め直せる。
 */
audience.post('/api/audience/report', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const channel = typeof body.channel === 'string' ? body.channel.trim() : '';
    if (!channel) return c.json({ success: false, error: 'channel is required' }, 400);

    const accounts = Array.isArray(body.accounts) ? body.accounts : [];
    if (accounts.length === 0) {
      return c.json({ success: false, error: 'accounts must be a non-empty array' }, 400);
    }

    const capturedOn =
      typeof body.capturedOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.capturedOn)
        ? body.capturedOn
        : undefined;

    let recorded = 0;
    for (const account of accounts) {
      const accountKey =
        typeof account?.accountKey === 'string'
          ? account.accountKey
          : typeof account?.key === 'string'
            ? account.key
            : '';
      const total = Number(account?.total);
      // 系列を特定できない行、数でない値は取り込まない。入れると毎回別行になって
      // 増減が出せなくなる。
      if (!accountKey || !Number.isFinite(total)) continue;

      await recordAudienceSnapshot(c.env.DB, {
        channel,
        accountKey: accountKey.slice(0, 200),
        accountLabel: typeof account.label === 'string' ? account.label.slice(0, 200) : null,
        total,
        source: 'report',
        capturedOn,
      });
      recorded++;
    }

    if (recorded === 0) {
      return c.json(
        { success: false, error: 'no usable account rows (each needs accountKey and total)' },
        400,
      );
    }
    return c.json({ success: true, data: { channel, recorded } });
  } catch (err) {
    console.error('POST /api/audience/report error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/** POST /api/audience/collect — cron を待たずに今すぐ集める (設定直後の確認用)。 */
audience.post('/api/audience/collect', async (c) => {
  try {
    const result = await collectAudience(c.env.DB, harnessSourcesFromEnv(c.env));
    return c.json({ success: true, data: result });
  } catch (err) {
    console.error('POST /api/audience/collect error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { audience };
