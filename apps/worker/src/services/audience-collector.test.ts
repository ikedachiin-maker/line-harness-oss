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
      fetcher: undefined,
    });
    expect(sources.find((s) => s.channel === 'mail')?.url).toBeUndefined();
  });

  it('carries the service binding through when one is bound', () => {
    const binding = { fetch: vi.fn() } as unknown as { fetch: typeof fetch };
    const sources = harnessSourcesFromEnv({
      MAIL_HARNESS_API_KEY: 'km',
      MAIL_HARNESS_SERVICE: binding,
    });
    expect(sources.find((s) => s.channel === 'mail')?.fetcher).toBe(binding);
  });

  // Threads は1デプロイ＝1アカウント。2アカウントあれば Worker も2つ。
  it('picks up numbered siblings on the same channel', () => {
    const a = { fetch: vi.fn() } as unknown as { fetch: typeof fetch };
    const b = { fetch: vi.fn() } as unknown as { fetch: typeof fetch };
    const sources = harnessSourcesFromEnv({
      THREADS_HARNESS_API_KEY: 'k1',
      THREADS_HARNESS_SERVICE: a,
      THREADS_HARNESS_API_KEY_2: 'k2',
      THREADS_HARNESS_SERVICE_2: b,
    });
    const threads = sources.filter((s) => s.channel === 'threads');
    expect(threads).toHaveLength(2);
    expect(threads[0]).toMatchObject({ apiKey: 'k1', fetcher: a });
    expect(threads[1]).toMatchObject({ apiKey: 'k2', fetcher: b });
    // 他チャネルは1本目だけ (未設定でも並ぶ)
    expect(sources.filter((s) => s.channel === 'x')).toHaveLength(1);
  });

  it('stops at the first gap in the numbering', () => {
    const sources = harnessSourcesFromEnv({
      THREADS_HARNESS_URL: 'https://t1.example',
      THREADS_HARNESS_API_KEY: 'k1',
      THREADS_HARNESS_URL_3: 'https://t3.example',
      THREADS_HARNESS_API_KEY_3: 'k3',
    });
    expect(sources.filter((s) => s.channel === 'threads')).toHaveLength(1);
  });

  it('ignores a SERVICE value that is not a fetcher', () => {
    const sources = harnessSourcesFromEnv({ X_HARNESS_SERVICE: 'not-a-binding', X_HARNESS_API_KEY: 'k' });
    expect(sources.find((s) => s.channel === 'x')?.fetcher).toBeUndefined();
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

  // 同一アカウントの Worker は *.workers.dev では届かない(Cloudflare が 404 を返す)。
  // binding があるときは global fetch を使わず、必ず binding 側を通す。
  it('uses the service binding instead of global fetch when one is bound', async () => {
    globalThis.fetch = vi.fn() as typeof globalThis.fetch;
    const seen: { url: string; auth: string | null }[] = [];
    const fetcher = {
      fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        seen.push({
          url: String(input),
          auth: new Headers(init?.headers).get('Authorization'),
        });
        return okResponse({
          channel: 'mail',
          accounts: [{ key: 'mail-harness', label: '池田宜史', total: 42 }],
        });
      }),
    } as unknown as { fetch: typeof fetch };

    const result = await collectAudience(
      DB,
      [{ channel: 'mail', url: 'https://mail.example', apiKey: 'km', fetcher }],
      { today: '2026-09-11' },
    );

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(seen).toEqual([{ url: 'https://mail.example/api/audience', auth: 'Bearer km' }]);
    expect(result.recorded).toBe(1);
  });

  // binding だけで URL が無くても集められること (URL は binding では使われない)。
  it('collects through a binding that has no url configured', async () => {
    globalThis.fetch = vi.fn() as typeof globalThis.fetch;
    const fetcher = {
      fetch: vi.fn(async () =>
        okResponse({ channel: 'x', accounts: [{ key: 'acc', total: 7 }] }),
      ),
    } as unknown as { fetch: typeof fetch };

    const result = await collectAudience(DB, [{ channel: 'x', apiKey: 'kx', fetcher }], {
      today: '2026-09-11',
    });

    expect(result.recorded).toBe(1);
    expect(result.failures).toEqual([]);
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
