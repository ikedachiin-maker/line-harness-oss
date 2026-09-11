import { describe, expect, test, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  recordAudienceSnapshot,
  getAudienceOverview,
  getAudienceHistory,
  countLineFriendsByAccount,
  jstDaysBefore,
  jstToday,
} from '../src/audience.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');
const MIGRATIONS_DIR = join(PKG_ROOT, 'migrations');

const BENIGN = /duplicate column name|already exists/i;

function execSafe(db: Database.Database, sql: string): void {
  for (const stmt of sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean)) {
    try {
      db.exec(stmt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!BENIGN.test(msg)) throw err;
    }
  }
}

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  execSafe(db, readFileSync(join(PKG_ROOT, 'schema.sql'), 'utf8'));
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    execSafe(db, readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }
  return db;
}

function asD1(sqlite: Database.Database): D1Database {
  return {
    prepare(query: string) {
      return {
        bind(...params: unknown[]) {
          const stmt = sqlite.prepare(query);
          return {
            async run() {
              stmt.run(...params);
              return { results: [], success: true, meta: {} };
            },
            async first<T>() {
              return (stmt.get(...params) as T) ?? null;
            },
            async all<T>() {
              return { results: stmt.all(...params) as T[], success: true, meta: {} };
            },
          };
        },
        async run() {
          sqlite.prepare(query).run();
          return { results: [], success: true, meta: {} };
        },
        async first<T>() {
          return (sqlite.prepare(query).get() as T) ?? null;
        },
        async all<T>() {
          return { results: sqlite.prepare(query).all() as T[], success: true, meta: {} };
        },
      };
    },
  } as unknown as D1Database;
}

const TODAY = '2026-09-11';

let sqlite: Database.Database;
let db: D1Database;

beforeEach(() => {
  sqlite = setupDb();
  db = asD1(sqlite);
});

describe('jstDaysBefore', () => {
  test('walks back by calendar day', () => {
    expect(jstDaysBefore(7, '2026-09-11')).toBe('2026-09-04');
    expect(jstDaysBefore(30, '2026-09-11')).toBe('2026-08-12');
  });

  test('crosses a month and a year boundary', () => {
    expect(jstDaysBefore(1, '2026-03-01')).toBe('2026-02-28');
    expect(jstDaysBefore(1, '2026-01-01')).toBe('2025-12-31');
  });

  test('jstToday takes the date part of a JST timestamp', () => {
    expect(jstToday('2026-09-11T23:59:59.999+09:00')).toBe('2026-09-11');
  });
});

describe('recordAudienceSnapshot', () => {
  // cron は毎分回る。UPSERT が効いていないと1日で1,440行積む。
  test('folds repeated writes on the same day into one row', async () => {
    for (const total of [100, 101, 103]) {
      await recordAudienceSnapshot(db, {
        channel: 'x',
        accountKey: '@admarkeikeda',
        total,
        capturedOn: TODAY,
      });
    }
    const rows = sqlite.prepare(`SELECT total FROM audience_snapshots`).all() as { total: number }[];
    expect(rows).toEqual([{ total: 103 }]);
  });

  test('keeps a label it already has when a later write omits one', async () => {
    await recordAudienceSnapshot(db, {
      channel: 'x',
      accountKey: 'acc',
      accountLabel: '@admarkeikeda',
      total: 100,
      capturedOn: TODAY,
    });
    await recordAudienceSnapshot(db, { channel: 'x', accountKey: 'acc', total: 110, capturedOn: TODAY });

    const row = sqlite
      .prepare(`SELECT account_label, total FROM audience_snapshots`)
      .get() as { account_label: string; total: number };
    expect(row).toEqual({ account_label: '@admarkeikeda', total: 110 });
  });

  test('separate days are separate rows', async () => {
    await recordAudienceSnapshot(db, { channel: 'x', accountKey: 'a', total: 100, capturedOn: '2026-09-10' });
    await recordAudienceSnapshot(db, { channel: 'x', accountKey: 'a', total: 105, capturedOn: TODAY });
    const n = sqlite.prepare(`SELECT count(*) AS n FROM audience_snapshots`).get() as { n: number };
    expect(n.n).toBe(2);
  });

  test('a negative or fractional count is normalised', async () => {
    await recordAudienceSnapshot(db, { channel: 'x', accountKey: 'a', total: -5, capturedOn: TODAY });
    await recordAudienceSnapshot(db, { channel: 'x', accountKey: 'b', total: 12.7, capturedOn: TODAY });
    const rows = sqlite
      .prepare(`SELECT account_key, total FROM audience_snapshots ORDER BY account_key`)
      .all() as { account_key: string; total: number }[];
    expect(rows).toEqual([
      { account_key: 'a', total: 0 },
      { account_key: 'b', total: 12 },
    ]);
  });
});

describe('getAudienceOverview', () => {
  async function seed() {
    const rows: [string, string, string, number, string][] = [
      // channel, accountKey, label, total, capturedOn
      ['line', 'acc-main', 'メインLINE', 1200, jstDaysBefore(30, TODAY)],
      ['line', 'acc-main', 'メインLINE', 1300, jstDaysBefore(7, TODAY)],
      ['line', 'acc-main', 'メインLINE', 1340, TODAY],
      ['mail', 'utage-purchasers', '購入者リスト', 800, jstDaysBefore(7, TODAY)],
      ['mail', 'utage-purchasers', '購入者リスト', 815, TODAY],
      ['x', '@admarkeikeda', '@admarkeikeda', 500, jstDaysBefore(7, TODAY)],
      ['x', '@admarkeikeda', '@admarkeikeda', 530, TODAY],
    ];
    for (const [channel, accountKey, accountLabel, total, capturedOn] of rows) {
      await recordAudienceSnapshot(db, { channel, accountKey, accountLabel, total, capturedOn });
    }
  }

  test('totals every channel and reports the deltas', async () => {
    await seed();
    const overview = await getAudienceOverview(db, { today: TODAY });

    expect(overview.total).toBe(1340 + 815 + 530);
    expect(overview.delta7d).toBe(40 + 15 + 30);

    const line = overview.channels.find((c) => c.channel === 'line')!;
    expect(line.total).toBe(1340);
    expect(line.delta7d).toBe(40);
    expect(line.delta30d).toBe(140);
  });

  // mail と x には30日前の行が無い。0 として足すと「30日で+1345」に見えてしまう。
  test('leaves a delta null when there is no history to compare against', async () => {
    await seed();
    const overview = await getAudienceOverview(db, { today: TODAY });
    const mail = overview.channels.find((c) => c.channel === 'mail')!;
    expect(mail.delta7d).toBe(15);
    expect(mail.delta30d).toBeNull();
  });

  test('orders known channels first and names the ones never reported', async () => {
    await seed();
    const overview = await getAudienceOverview(db, { today: TODAY });
    expect(overview.channels.map((c) => c.channel)).toEqual(['line', 'mail', 'x']);
    expect(overview.missingChannels).toEqual(['instagram', 'threads']);
  });

  // 収集が1日飛んでも増減が消えないこと。基準日ちょうどの行ではなく
  // 「その日以前で最も新しい行」を使う。
  test('falls back to the newest row at or before the baseline date', async () => {
    await recordAudienceSnapshot(db, {
      channel: 'x',
      accountKey: 'a',
      total: 100,
      capturedOn: jstDaysBefore(9, TODAY),
    });
    await recordAudienceSnapshot(db, { channel: 'x', accountKey: 'a', total: 130, capturedOn: TODAY });

    const overview = await getAudienceOverview(db, { today: TODAY });
    expect(overview.channels[0].delta7d).toBe(30);
  });

  // 集計が止まった系列を最新値として出し続けるのは正しい。0 に落とすと
  // 「全員いなくなった」に見える。代わりに capturedOn が古いことで気づける。
  test('keeps showing a stale series at its last known value', async () => {
    await recordAudienceSnapshot(db, {
      channel: 'threads',
      accountKey: '@infrajigyo',
      total: 420,
      capturedOn: jstDaysBefore(20, TODAY),
    });
    const overview = await getAudienceOverview(db, { today: TODAY });
    const threads = overview.channels.find((c) => c.channel === 'threads')!;
    expect(threads.total).toBe(420);
    expect(threads.capturedOn).toBe(jstDaysBefore(20, TODAY));
  });

  // 未来日の行を混ぜても「今日」の数字がずれないこと。report は capturedOn を
  // 指定できるので、送り手が日付を間違える余地がある。
  test('ignores rows dated after today', async () => {
    await recordAudienceSnapshot(db, { channel: 'x', accountKey: 'a', total: 100, capturedOn: TODAY });
    await recordAudienceSnapshot(db, {
      channel: 'x',
      accountKey: 'a',
      total: 99999,
      capturedOn: '2027-01-01',
    });
    const overview = await getAudienceOverview(db, { today: TODAY });
    expect(overview.total).toBe(100);
  });

  test('is empty rather than throwing when nothing has been collected', async () => {
    const overview = await getAudienceOverview(db, { today: TODAY });
    expect(overview.total).toBe(0);
    expect(overview.delta7d).toBeNull();
    expect(overview.channels).toEqual([]);
    expect(overview.missingChannels).toEqual(['line', 'mail', 'x', 'instagram', 'threads']);
  });

  test('sums multiple accounts within one channel', async () => {
    await recordAudienceSnapshot(db, { channel: 'line', accountKey: 'a', total: 100, capturedOn: TODAY });
    await recordAudienceSnapshot(db, { channel: 'line', accountKey: 'b', total: 250, capturedOn: TODAY });
    const overview = await getAudienceOverview(db, { today: TODAY });
    expect(overview.channels[0].total).toBe(350);
    expect(overview.channels[0].accounts).toHaveLength(2);
  });
});

describe('getAudienceHistory', () => {
  test('returns one point per day for a single account', async () => {
    await recordAudienceSnapshot(db, { channel: 'x', accountKey: 'a', total: 10, capturedOn: '2026-09-09' });
    await recordAudienceSnapshot(db, { channel: 'x', accountKey: 'a', total: 12, capturedOn: '2026-09-10' });
    await recordAudienceSnapshot(db, { channel: 'x', accountKey: 'a', total: 15, capturedOn: TODAY });

    const rows = await getAudienceHistory(db, { channel: 'x', accountKey: 'a', today: TODAY });
    expect(rows).toEqual([
      { capturedOn: '2026-09-09', total: 10 },
      { capturedOn: '2026-09-10', total: 12 },
      { capturedOn: '2026-09-11', total: 15 },
    ]);
  });

  test('sums accounts per day when no account is named', async () => {
    await recordAudienceSnapshot(db, { channel: 'line', accountKey: 'a', total: 10, capturedOn: TODAY });
    await recordAudienceSnapshot(db, { channel: 'line', accountKey: 'b', total: 5, capturedOn: TODAY });
    const rows = await getAudienceHistory(db, { channel: 'line', today: TODAY });
    expect(rows).toEqual([{ capturedOn: TODAY, total: 15 }]);
  });

  test('honours the day window', async () => {
    await recordAudienceSnapshot(db, {
      channel: 'x',
      accountKey: 'a',
      total: 1,
      capturedOn: jstDaysBefore(100, TODAY),
    });
    await recordAudienceSnapshot(db, { channel: 'x', accountKey: 'a', total: 9, capturedOn: TODAY });
    const rows = await getAudienceHistory(db, { channel: 'x', accountKey: 'a', days: 30, today: TODAY });
    expect(rows).toEqual([{ capturedOn: TODAY, total: 9 }]);
  });
});

describe('countLineFriendsByAccount', () => {
  function insertFriend(id: string, accountId: string | null, following = 1) {
    sqlite
      .prepare(
        `INSERT INTO friends (id, line_user_id, line_account_id, is_following, created_at, updated_at)
         VALUES (?, ?, ?, ?, '2026-01-01T00:00:00.000+09:00', '2026-01-01T00:00:00.000+09:00')`,
      )
      .run(id, `U-${id}`, accountId, following);
  }

  beforeEach(() => {
    sqlite
      .prepare(
        `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
         VALUES ('acc-1', 'ch-1', 'メインLINE', 't', 's')`,
      )
      .run();
  });

  // 画面に出したいのは「いま届く人数」。LINE 管理画面のターゲットリーチと
  // 意味を揃えるため、ブロックした人は数えない。
  test('counts only friends who are still following', async () => {
    insertFriend('f1', 'acc-1');
    insertFriend('f2', 'acc-1');
    insertFriend('f3', 'acc-1', 0);

    const rows = await countLineFriendsByAccount(db);
    expect(rows).toEqual([{ accountKey: 'acc-1', accountLabel: 'メインLINE', total: 2 }]);
  });

  // 複数アカウント運用前に追加された友だちは line_account_id が NULL。
  // これを落とすと総数が本当の人数より少なく出る。
  test("buckets friends with no account id under 'default'", async () => {
    insertFriend('f1', null);
    insertFriend('f2', 'acc-1');

    const rows = await countLineFriendsByAccount(db);
    expect(rows).toEqual(
      expect.arrayContaining([
        { accountKey: 'default', accountLabel: null, total: 1 },
        { accountKey: 'acc-1', accountLabel: 'メインLINE', total: 1 },
      ]),
    );
    expect(rows.reduce((s, r) => s + r.total, 0)).toBe(2);
  });

  test('returns nothing when there are no friends', async () => {
    expect(await countLineFriendsByAccount(db)).toEqual([]);
  });
});
