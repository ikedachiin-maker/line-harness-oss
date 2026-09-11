import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  collectAudience,
  harnessSourcesFromEnv,
  jstHour,
  type HarnessSource,
} from './audience-collector.js';

const dbMocks = vi.hoisted(() => ({
  recordAudienceSnapshot: vi.fn(),
  countLineFriendsByAccount: vi.fn(),
  jstToday: vi.fn(() => '2026-09-11'),
}));
vi.mock('@line-crm/db', () => dbMocks);

const DB = {} as D1Database;

function okResponse(data: unknown) {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.countLineFriendsByAccount.mockResolvedValue([]);
  dbMocks.recordAudienceSnapshot.mockResolvedValue(undefined);
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('jstHour', () => {
  // Workers の cron は UTC で走る。JST 04:00 は UTC 19:00 の前日。
  it('converts a UTC cron time to the JST hour', () => {
    expect(jstHour(Date.parse('2026-09-10T19:00:00Z'))).toBe(4);
    expect(jstHour(Date.parse('2026-09-11T00:00:00Z'))).toBe(9);
    expect(jstHour(Date.parse('2026-09-11T15:30:00Z'))).toBe(0);
  });
});

describe('harnessSourcesFromEnv', () => {
  it('lists every channel, leaving unset ones without credentials', () => {
    const sources = harnessSourcesFromEnv({
      X_HARNESS_URL: 'https://x.example',
      X_HARNESS_API_KEY: 'kx',
    });
    expect(sources.map((s) => s.channel)).toEqual(['x', 'instagram', 'threads', 'mail']);
    expect(sources.find((s) => s.channel === 'x')).toEqual({
      channel: 'x',
      url: 'https://x.example',
      apiKey: 'kx',
    });
    expect(sources.find((s) => s.channel === 'mail')?.url).toBeUndefined();
  });
});

describe('collectAudience', () => {
  it('records the LINE friend count from the local database', async () => {
    dbMocks.countLineFriendsByAccount.mockResolvedValue([
      { accountKey: 'acc-1', accountLabel: 'メインLINE', total: 1340 },
    ]);

    const result = await collectAudience(DB, [], { today: '2026-09-11' });

    expect(result.recorded).toBe(1);
    expect(dbMocks.recordAudienceSnapshot).toHaveBeenCalledWith(DB, {
      channel: 'line',
      accountKey: 'acc-1',
      accountLabel: 'メインLINE',
      total: 1340,
      source: 'self',
      capturedOn: '2026-09-11',
    });
  });

  it('polls a configured harness and records what it returns', async () => {
    const seen: { url: string; auth: string | null }[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({
        url: String(input),
        auth: new Headers(init?.headers).get('Authorization'),
      });
      return okResponse({
        channel: 'x',
        accounts: [{ key: '@admarkeikeda', label: '@admarkeikeda', total: 530 }],
      });
    }) as typeof globalThis.fetch;

    const sources: HarnessSource[] = [
      // 末尾スラッシュ付きでも二重スラッシュにならないこと
      { channel: 'x', url: 'https://x.example/', apiKey: 'kx' },
    ];
    const result = await collectAudience(DB, sources, { today: '2026-09-11' });

    expect(seen).toEqual([{ url: 'https://x.example/api/audience', auth: 'Bearer kx' }]);
    expect(result.recorded).toBe(1);
    expect(dbMocks.recordAudienceSnapshot).toHaveBeenCalledWith(DB, {
      channel: 'x',
      accountKey: '@admarkeikeda',
      accountLabel: '@admarkeikeda',
      total: 530,
      source: 'poll',
      capturedOn: '2026-09-11',
    });
  });

  it('skips a source that has no url or no api key', async () => {
    globalThis.fetch = vi.fn() as typeof globalThis.fetch;
    await collectAudience(
      DB,
      [
        { channel: 'x', url: 'https://x.example' },
        { channel: 'mail', apiKey: 'k' },
        { channel: 'threads' },
      ],
      { today: '2026-09-11' },
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  // 1本落ちたら全部止まる、では困る。X が死んでいてもメールの数字は入ってほしい。
  it('keeps collecting the other channels when one fails', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('x.example')) return new Response('boom', { status: 500 });
      return okResponse({ channel: 'mail', accounts: [{ key: 'list-1', total: 815 }] });
    }) as typeof globalThis.fetch;

    const result = await collectAudience(
      DB,
      [
        { channel: 'x', url: 'https://x.example', apiKey: 'kx' },
        { channel: 'mail', url: 'https://mail.example', apiKey: 'km' },
      ],
      { today: '2026-09-11' },
    );

    expect(result.recorded).toBe(1);
    expect(result.failures).toEqual([{ channel: 'x', reason: 'HTTP 500' }]);
    expect(dbMocks.recordAudienceSnapshot).toHaveBeenCalledWith(
      DB,
      expect.objectContaining({ channel: 'mail', accountKey: 'list-1', total: 815 }),
    );
  });

  it('reports a network error as a failure instead of throwing', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down');
    }) as typeof globalThis.fetch;

    const result = await collectAudience(DB, [{ channel: 'x', url: 'https://x.example', apiKey: 'k' }]);
    expect(result.failures).toEqual([{ channel: 'x', reason: 'network down' }]);
  });

  // key の無い行を取り込むと、毎日別の系列として積まれて増減が出せなくなる。
  it('drops account rows with no key or a non-numeric total', async () => {
    globalThis.fetch = vi.fn(async () =>
      okResponse({
        channel: 'x',
        accounts: [
          { label: 'no key', total: 10 },
          { key: 'ok', total: 'many' },
          { key: 'good', total: 42 },
        ],
      }),
    ) as typeof globalThis.fetch;

    const result = await collectAudience(DB, [{ channel: 'x', url: 'https://x.example', apiKey: 'k' }]);
    expect(result.recorded).toBe(1);
    expect(dbMocks.recordAudienceSnapshot).toHaveBeenCalledTimes(1);
    expect(dbMocks.recordAudienceSnapshot).toHaveBeenCalledWith(
      DB,
      expect.objectContaining({ accountKey: 'good', total: 42 }),
    );
  });

  it('accepts accountKey as well as key', async () => {
    globalThis.fetch = vi.fn(async () =>
      okResponse({ channel: 'instagram', accounts: [{ accountKey: 'ig-1', total: 77 }] }),
    ) as typeof globalThis.fetch;

    await collectAudience(DB, [{ channel: 'instagram', url: 'https://ig.example', apiKey: 'k' }]);
    expect(dbMocks.recordAudienceSnapshot).toHaveBeenCalledWith(
      DB,
      expect.objectContaining({ channel: 'instagram', accountKey: 'ig-1', total: 77 }),
    );
  });

  it('falls back to the configured channel when the response omits one', async () => {
    globalThis.fetch = vi.fn(async () =>
      okResponse({ accounts: [{ key: 'a', total: 1 }] }),
    ) as typeof globalThis.fetch;

    await collectAudience(DB, [{ channel: 'threads', url: 'https://t.example', apiKey: 'k' }]);
    expect(dbMocks.recordAudienceSnapshot).toHaveBeenCalledWith(
      DB,
      expect.objectContaining({ channel: 'threads' }),
    );
  });

  it('treats a success:false envelope as a failure', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ success: false, error: 'nope' }), { status: 200 }),
    ) as typeof globalThis.fetch;

    const result = await collectAudience(DB, [{ channel: 'x', url: 'https://x.example', apiKey: 'k' }]);
    expect(result.recorded).toBe(0);
    expect(result.failures[0].channel).toBe('x');
  });

  // LINE 側が壊れても、外部チャネルの収集は続ける。
  it('records a LINE failure without aborting the poll', async () => {
    dbMocks.countLineFriendsByAccount.mockRejectedValue(new Error('no such table: friends'));
    globalThis.fetch = vi.fn(async () =>
      okResponse({ channel: 'x', accounts: [{ key: 'a', total: 5 }] }),
    ) as typeof globalThis.fetch;

    const result = await collectAudience(DB, [{ channel: 'x', url: 'https://x.example', apiKey: 'k' }]);
    expect(result.recorded).toBe(1);
    expect(result.failures).toEqual([{ channel: 'line', reason: 'no such table: friends' }]);
  });
});
