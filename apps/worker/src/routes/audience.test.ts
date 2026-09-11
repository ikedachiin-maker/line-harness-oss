import { describe, it, expect, vi, beforeEach } from 'vitest';

// Route-level test for /api/audience*. The db layer is mocked; the real
// aggregation is covered against SQLite in packages/db/test/audience.test.ts.
const dbMocks = {
  // eager module-load deps (mirror other route tests)
  getLineAccounts: vi.fn().mockResolvedValue([]),
  getStaffByApiKey: vi.fn(),
  recoverStalledBroadcasts: vi.fn(),
  recoverStuckDeliveries: vi.fn(),
  // audience route deps
  getAudienceOverview: vi.fn(),
  getAudienceHistory: vi.fn(),
  recordAudienceSnapshot: vi.fn(),
  countLineFriendsByAccount: vi.fn(),
  jstToday: vi.fn(() => '2026-09-11'),
};
vi.mock('@line-crm/db', () => dbMocks);

const worker = (await import('../index.js')).default;

const API_KEY = 'test-owner-key';
const env = {
  DB: {} as D1Database,
  LINE_LOGIN_CHANNEL_ID: '2000000000',
  API_KEY,
  WORKER_URL: 'https://worker.example.com',
} as unknown as import('../index.js').Env['Bindings'];

function call(path: string, init: RequestInit & { auth?: boolean } = {}) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (init.auth !== false) headers.set('Authorization', `Bearer ${API_KEY}`);
  return worker.fetch(
    new Request(`https://worker.example.com${path}`, { ...init, headers }),
    env,
    { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext,
  );
}

const post = (path: string, body: unknown, opts: { auth?: boolean } = {}) =>
  call(path, { method: 'POST', body: JSON.stringify(body), ...opts });

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getLineAccounts.mockResolvedValue([]);
  dbMocks.jstToday.mockReturnValue('2026-09-11');
  dbMocks.countLineFriendsByAccount.mockResolvedValue([]);
  dbMocks.recordAudienceSnapshot.mockResolvedValue(undefined);
});

describe('GET /api/audience', () => {
  // 5ハーネスで同じ形を返すことが、この画面が成り立つ前提になっている。
  it('reports this harness in the shared shape', async () => {
    dbMocks.countLineFriendsByAccount.mockResolvedValue([
      { accountKey: 'acc-1', accountLabel: 'メインLINE', total: 1340 },
    ]);

    const res = await call('/api/audience');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: {
        channel: 'line',
        accounts: [{ key: 'acc-1', label: 'メインLINE', total: 1340 }],
      },
    });
  });

  it('requires authentication', async () => {
    const res = await call('/api/audience', { auth: false });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/audience/overview', () => {
  it('returns the aggregated view', async () => {
    const overview = { total: 2685, delta7d: 85, delta30d: null, channels: [], missingChannels: [] };
    dbMocks.getAudienceOverview.mockResolvedValue(overview);

    const res = await call('/api/audience/overview');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: overview });
  });
});

describe('GET /api/audience/history', () => {
  it('passes the channel, account and window through', async () => {
    dbMocks.getAudienceHistory.mockResolvedValue([]);
    await call('/api/audience/history?channel=x&accountKey=acc-1&days=30');
    expect(dbMocks.getAudienceHistory).toHaveBeenCalledWith(env.DB, {
      channel: 'x',
      accountKey: 'acc-1',
      days: 30,
    });
  });

  it('rejects a request with no channel', async () => {
    const res = await call('/api/audience/history');
    expect(res.status).toBe(400);
    expect(dbMocks.getAudienceHistory).not.toHaveBeenCalled();
  });

  // 上限を切らないと1系列で数千行返しうる。
  it('clamps an absurd or malformed day window', async () => {
    dbMocks.getAudienceHistory.mockResolvedValue([]);
    for (const [query, expected] of [
      ['days=99999', 365],
      ['days=0', 1],
      ['days=-5', 1],
      ['days=abc', 90],
      ['', 90],
    ] as const) {
      dbMocks.getAudienceHistory.mockClear();
      await call(`/api/audience/history?channel=x${query ? `&${query}` : ''}`);
      expect(dbMocks.getAudienceHistory).toHaveBeenCalledWith(
        env.DB,
        expect.objectContaining({ days: expected }),
      );
    }
  });
});

describe('POST /api/audience/report', () => {
  // UTAGE のメルマガ読者数がこの口から入る。UTAGE の API キーは ikeda-os 側に
  // あるので、あちらが読んで送り込む。
  it('records every usable account row', async () => {
    const res = await post('/api/audience/report', {
      channel: 'mail',
      capturedOn: '2026-09-11',
      accounts: [
        { key: 'utage-purchasers', label: '購入者リスト', total: 815 },
        { accountKey: 'utage-mnp', label: 'mnp無料コンサル', total: 342 },
      ],
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { channel: 'mail', recorded: 2 } });
    expect(dbMocks.recordAudienceSnapshot).toHaveBeenCalledWith(env.DB, {
      channel: 'mail',
      accountKey: 'utage-purchasers',
      accountLabel: '購入者リスト',
      total: 815,
      source: 'report',
      capturedOn: '2026-09-11',
    });
  });

  it('defaults to today when no date is given', async () => {
    await post('/api/audience/report', {
      channel: 'mail',
      accounts: [{ key: 'a', total: 1 }],
    });
    expect(dbMocks.recordAudienceSnapshot).toHaveBeenCalledWith(
      env.DB,
      expect.objectContaining({ capturedOn: undefined }),
    );
  });

  it('ignores a malformed capturedOn rather than storing it', async () => {
    await post('/api/audience/report', {
      channel: 'mail',
      capturedOn: '11/09/2026',
      accounts: [{ key: 'a', total: 1 }],
    });
    expect(dbMocks.recordAudienceSnapshot).toHaveBeenCalledWith(
      env.DB,
      expect.objectContaining({ capturedOn: undefined }),
    );
  });

  // key の無い行を取り込むと毎回別の系列になり、増減が出せなくなる。
  it('drops rows with no key or a non-numeric total', async () => {
    const res = await post('/api/audience/report', {
      channel: 'mail',
      accounts: [
        { label: 'no key', total: 10 },
        { key: 'bad', total: 'many' },
        { key: 'good', total: 42 },
      ],
    });
    expect((await res.json() as { data: { recorded: number } }).data.recorded).toBe(1);
    expect(dbMocks.recordAudienceSnapshot).toHaveBeenCalledTimes(1);
  });

  // 全部落ちたときに 200 を返すと、送り手は成功したと思い込んで気づけない。
  it('fails loudly when no row was usable', async () => {
    const res = await post('/api/audience/report', {
      channel: 'mail',
      accounts: [{ label: 'no key', total: 10 }],
    });
    expect(res.status).toBe(400);
    expect(dbMocks.recordAudienceSnapshot).not.toHaveBeenCalled();
  });

  it('rejects a missing channel or an empty accounts array', async () => {
    for (const body of [
      {},
      { channel: 'mail' },
      { channel: 'mail', accounts: [] },
      { accounts: [{ key: 'a', total: 1 }] },
    ]) {
      const res = await post('/api/audience/report', body);
      expect(res.status).toBe(400);
    }
    expect(dbMocks.recordAudienceSnapshot).not.toHaveBeenCalled();
  });

  it('requires authentication', async () => {
    const res = await post(
      '/api/audience/report',
      { channel: 'mail', accounts: [{ key: 'a', total: 1 }] },
      { auth: false },
    );
    expect(res.status).toBe(401);
    expect(dbMocks.recordAudienceSnapshot).not.toHaveBeenCalled();
  });
});
