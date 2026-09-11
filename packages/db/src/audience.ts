import { jstNow } from './utils.js';

// =============================================================================
// Audience — 全チャネルの名簿規模を1画面で見る
// =============================================================================
//
// メルマガ読者数・LINE友だち数・各SNSのフォロワー数は、いま5ハーネスと UTAGE に
// 散らばっている。名簿そのものを寄せ集めると人が二重に存在してしまうので、
// 人数だけを日次で1テーブルに積む。詳細は
// migrations/071_audience_snapshots.sql。

/** 既知のチャネル。表示順もこの順に固定する。 */
export const AUDIENCE_CHANNELS = ['line', 'mail', 'x', 'instagram', 'threads'] as const;

export type AudienceSource = 'self' | 'poll' | 'report';

export interface AudienceSnapshot {
  id: string;
  channel: string;
  account_key: string;
  account_label: string | null;
  total: number;
  source: string;
  captured_on: string;
  captured_at: string;
}

/** JST の「今日」。captured_on の既定値。 */
export function jstToday(now: string = jstNow()): string {
  return now.slice(0, 10);
}

/** JST で days 日前の日付。差分の比較基準に使う。 */
export function jstDaysBefore(days: number, from: string = jstToday()): string {
  const [y, m, d] = from.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) - days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export interface RecordAudienceInput {
  channel: string;
  accountKey: string;
  accountLabel?: string | null;
  total: number;
  source?: AudienceSource;
  capturedOn?: string;
}

/**
 * その日の人数を1行に畳んで記録する。
 *
 * cron は毎分回るので、同じ日に何度呼ばれても行が増えないことが要る。
 * UNIQUE(channel, account_key, captured_on) に対する UPSERT で、最後に測った値が残る。
 */
export async function recordAudienceSnapshot(
  db: D1Database,
  input: RecordAudienceInput,
): Promise<void> {
  const capturedOn = input.capturedOn ?? jstToday();
  const now = jstNow();

  await db
    .prepare(
      `INSERT INTO audience_snapshots
         (id, channel, account_key, account_label, total, source, captured_on, captured_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (channel, account_key, captured_on) DO UPDATE SET
         total         = excluded.total,
         account_label = COALESCE(excluded.account_label, audience_snapshots.account_label),
         source        = excluded.source,
         captured_at   = excluded.captured_at`,
    )
    .bind(
      crypto.randomUUID(),
      input.channel,
      input.accountKey,
      input.accountLabel ?? null,
      Math.max(0, Math.trunc(input.total)),
      input.source ?? 'poll',
      capturedOn,
      now,
    )
    .run();
}

export interface AudienceAccountRow {
  channel: string;
  accountKey: string;
  accountLabel: string | null;
  total: number;
  source: string;
  capturedOn: string;
  /** 7日前との差。比較できる過去が無ければ null (0 と区別する) */
  delta7d: number | null;
  delta30d: number | null;
}

export interface AudienceChannelRow {
  channel: string;
  total: number;
  delta7d: number | null;
  delta30d: number | null;
  accounts: AudienceAccountRow[];
  /** 最後に数字が入った日。古いままなら収集が止まっているサイン */
  capturedOn: string | null;
}

export interface AudienceOverview {
  total: number;
  delta7d: number | null;
  delta30d: number | null;
  channels: AudienceChannelRow[];
  /** 一度も数字が来ていないチャネル。設定漏れがそのまま見えるように残す */
  missingChannels: string[];
}

interface LatestRow {
  channel: string;
  account_key: string;
  account_label: string | null;
  total: number;
  source: string;
  captured_on: string;
}

/**
 * いまの人数と、7日前 / 30日前からの増減。
 *
 * 「最新」はアカウントごとに最後に入った行を指す。チャネルによって収集の頻度が
 * 違っても、止まっている系列を 0 として混ぜないようにこの形にしている。
 *
 * 過去の基準日はちょうどその日の行ではなく「その日以前で最も新しい行」を使う。
 * 収集が1日飛んでも差分が消えないようにするため。
 */
export async function getAudienceOverview(
  db: D1Database,
  opts: { today?: string } = {},
): Promise<AudienceOverview> {
  const today = opts.today ?? jstToday();
  const d7 = jstDaysBefore(7, today);
  const d30 = jstDaysBefore(30, today);

  const latest = await db
    .prepare(
      `SELECT s.channel, s.account_key, s.account_label, s.total, s.source, s.captured_on
         FROM audience_snapshots s
         JOIN (
           SELECT channel, account_key, MAX(captured_on) AS captured_on
             FROM audience_snapshots
            WHERE captured_on <= ?
            GROUP BY channel, account_key
         ) newest
           ON newest.channel = s.channel
          AND newest.account_key = s.account_key
          AND newest.captured_on = s.captured_on
        ORDER BY s.channel, s.account_key`,
    )
    .bind(today)
    .all<LatestRow>();

  const baselineFor = async (on: string): Promise<Map<string, number>> => {
    const rows = await db
      .prepare(
        `SELECT s.channel, s.account_key, s.total
           FROM audience_snapshots s
           JOIN (
             SELECT channel, account_key, MAX(captured_on) AS captured_on
               FROM audience_snapshots
              WHERE captured_on <= ?
              GROUP BY channel, account_key
           ) base
             ON base.channel = s.channel
            AND base.account_key = s.account_key
            AND base.captured_on = s.captured_on`,
      )
      .bind(on)
      .all<{ channel: string; account_key: string; total: number }>();
    return new Map(rows.results.map((r) => [`${r.channel} ${r.account_key}`, r.total]));
  };

  const [base7, base30] = await Promise.all([baselineFor(d7), baselineFor(d30)]);

  const byChannel = new Map<string, AudienceAccountRow[]>();
  for (const row of latest.results) {
    const key = `${row.channel} ${row.account_key}`;
    const prev7 = base7.get(key);
    const prev30 = base30.get(key);
    const account: AudienceAccountRow = {
      channel: row.channel,
      accountKey: row.account_key,
      accountLabel: row.account_label,
      total: row.total,
      source: row.source,
      capturedOn: row.captured_on,
      delta7d: prev7 === undefined ? null : row.total - prev7,
      delta30d: prev30 === undefined ? null : row.total - prev30,
    };
    const list = byChannel.get(row.channel);
    if (list) list.push(account);
    else byChannel.set(row.channel, [account]);
  }

  // 既知チャネルを先に、未知チャネル (あとから増えたもの) を後ろに並べる。
  const known = AUDIENCE_CHANNELS as readonly string[];
  const ordered = [
    ...known.filter((c) => byChannel.has(c)),
    ...[...byChannel.keys()].filter((c) => !known.includes(c)).sort(),
  ];

  // 差分は「両側に数字がある系列だけ」を足す。片方しか無い系列を 0 扱いで混ぜると、
  // 収集を始めた初日に全部が「急増」に見えてしまう。
  const sumDelta = (
    accounts: AudienceAccountRow[],
    pick: (a: AudienceAccountRow) => number | null,
  ): number | null => {
    const values = accounts.map(pick).filter((v): v is number => v !== null);
    return values.length === 0 ? null : values.reduce((a, b) => a + b, 0);
  };

  const channels: AudienceChannelRow[] = ordered.map((channel) => {
    const accounts = byChannel.get(channel)!;
    return {
      channel,
      total: accounts.reduce((sum, a) => sum + a.total, 0),
      delta7d: sumDelta(accounts, (a) => a.delta7d),
      delta30d: sumDelta(accounts, (a) => a.delta30d),
      accounts,
      capturedOn: accounts.reduce<string | null>(
        (max, a) => (max === null || a.capturedOn > max ? a.capturedOn : max),
        null,
      ),
    };
  });

  const allAccounts = channels.flatMap((c) => c.accounts);

  return {
    total: allAccounts.reduce((sum, a) => sum + a.total, 0),
    delta7d: sumDelta(allAccounts, (a) => a.delta7d),
    delta30d: sumDelta(allAccounts, (a) => a.delta30d),
    channels,
    missingChannels: known.filter((c) => !byChannel.has(c)),
  };
}

/** 1系列の推移。グラフ用。 */
export async function getAudienceHistory(
  db: D1Database,
  opts: { channel: string; accountKey?: string; days?: number; today?: string },
): Promise<{ capturedOn: string; total: number }[]> {
  const today = opts.today ?? jstToday();
  const since = jstDaysBefore(opts.days ?? 90, today);

  // accountKey 省略時はチャネル合計。日ごとに足すので、アカウントが増えた日も
  // その日の実数になる。
  const result = opts.accountKey
    ? await db
        .prepare(
          `SELECT captured_on, total FROM audience_snapshots
            WHERE channel = ? AND account_key = ? AND captured_on BETWEEN ? AND ?
            ORDER BY captured_on`,
        )
        .bind(opts.channel, opts.accountKey, since, today)
        .all<{ captured_on: string; total: number }>()
    : await db
        .prepare(
          `SELECT captured_on, SUM(total) AS total FROM audience_snapshots
            WHERE channel = ? AND captured_on BETWEEN ? AND ?
            GROUP BY captured_on ORDER BY captured_on`,
        )
        .bind(opts.channel, since, today)
        .all<{ captured_on: string; total: number }>();

  return result.results.map((r) => ({ capturedOn: r.captured_on, total: r.total }));
}

/**
 * 自分の LINE 友だち数をアカウント別に数える。
 *
 * ブロックした人 (is_following=0) は数えない。画面に出したいのは「いま届く人数」で、
 * LINE 管理画面のターゲットリーチと意味を揃える。
 */
export async function countLineFriendsByAccount(
  db: D1Database,
): Promise<{ accountKey: string; accountLabel: string | null; total: number }[]> {
  const result = await db
    .prepare(
      `SELECT COALESCE(f.line_account_id, 'default') AS account_key,
              a.name AS account_label,
              COUNT(*) AS total
         FROM friends f
         LEFT JOIN line_accounts a ON a.id = f.line_account_id
        WHERE f.is_following = 1
        GROUP BY COALESCE(f.line_account_id, 'default'), a.name
        ORDER BY total DESC`,
    )
    .all<{ account_key: string; account_label: string | null; total: number }>();

  return result.results.map((r) => ({
    accountKey: r.account_key,
    accountLabel: r.account_label,
    total: r.total,
  }));
}
