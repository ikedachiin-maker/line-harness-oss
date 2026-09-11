import { describe, it, expect, vi, beforeEach } from 'vitest';

// Route-level test for /api/ingest/*. The db layer is mocked; the real SQLite
// behaviour (nullable friend_id, the CHECK, user-side attribution) is covered
// in packages/db/test/070_channel_agnostic_conversions.test.ts and
// packages/db/test/mail-origin-attribution.test.ts. Here we assert the route
// validates input, wires body → db calls, and stays behind the auth gate.
const dbMocks = {
  // eager module-load deps (mirror other route tests)
  getLineAccounts: vi.fn().mockResolvedValue([]),
  getStaffByApiKey: vi.fn(),
  recoverStalledBroadcasts: vi.fn(),
  recoverStuckDeliveries: vi.fn(),
  // ingest route deps
  upsertUserByEmail: vi.fn(),
  getEntryRouteByRefCode: vi.fn(),
  recordRefTracking: vi.fn(),
  trackConversion: vi.fn(),
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

function post(path: string, body: unknown, opts: { auth?: boolean } = {}) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (opts.auth !== false) headers.set('Authorization', `Bearer ${API_KEY}`);
  return worker.fetch(
    new Request(`https://worker.example.com${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
    env,
    { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext,
  );
}

const USER = {
  id: 'user-1',
  email: 'reader@example.com',
  phone: null,
  external_id: null,
  display_name: null,
  created_at: '2026-09-10T12:00:00.000+09:00',
  updated_at: '2026-09-10T12:00:00.000+09:00',
};

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getLineAccounts.mockResolvedValue([]);
  dbMocks.upsertUserByEmail.mockResolvedValue(USER);
  dbMocks.getEntryRouteByRefCode.mockResolvedValue(null);
  dbMocks.recordRefTracking.mockResolvedValue({});
});

describe('POST /api/ingest/subscriber', () => {
  it('upserts the user and logs the ref touch against them', async () => {
    dbMocks.getEntryRouteByRefCode.mockResolvedValue({ id: 'er-1', ref_code: 'mailmaga-0910' });

    const res = await post('/api/ingest/subscriber', {
      email: 'Reader@Example.com',
      name: '読者A',
      refCode: 'mailmaga-0910',
      externalId: 'utage-8842',
      sourceUrl: 'https://sub.ad-marketing.xyz/p/abc',
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: { userId: 'user-1', refCode: 'mailmaga-0910', entryRouteId: 'er-1', refTracked: true },
    });

    expect(dbMocks.upsertUserByEmail).toHaveBeenCalledWith(env.DB, {
      email: 'Reader@Example.com',
      displayName: '読者A',
      externalId: 'utage-8842',
    });
    expect(dbMocks.recordRefTracking).toHaveBeenCalledWith(
      env.DB,
      expect.objectContaining({
        refCode: 'mailmaga-0910',
        userId: 'user-1',
        entryRouteId: 'er-1',
        sourceUrl: 'https://sub.ad-marketing.xyz/p/abc',
      }),
    );
  });

  // An unregistered ref_code must still be logged: createEntryRoute() backfills
  // entry_route_id when the code is registered later, so dropping the touch
  // here would silently lose the click.
  it('logs the touch even when the ref code is not a registered entry route', async () => {
    const res = await post('/api/ingest/subscriber', {
      email: 'reader@example.com',
      refCode: 'unregistered-code',
    });
    expect(res.status).toBe(200);
    expect(dbMocks.recordRefTracking).toHaveBeenCalledWith(
      env.DB,
      expect.objectContaining({ refCode: 'unregistered-code', entryRouteId: null }),
    );
  });

  it('records the user but no touch when no ref code is given', async () => {
    const res = await post('/api/ingest/subscriber', { email: 'reader@example.com' });
    expect(res.status).toBe(200);
    expect((await res.json() as { data: { refTracked: boolean } }).data.refTracked).toBe(false);
    expect(dbMocks.recordRefTracking).not.toHaveBeenCalled();
  });

  it('rejects a missing or malformed email', async () => {
    for (const body of [{}, { email: '' }, { email: 'not-an-email' }, { email: 12345 }]) {
      const res = await post('/api/ingest/subscriber', body);
      expect(res.status).toBe(400);
    }
    expect(dbMocks.upsertUserByEmail).not.toHaveBeenCalled();
  });

  // Ingest carries an email address, so it must never be reachable unauthenticated.
  it('requires authentication', async () => {
    const res = await post('/api/ingest/subscriber', { email: 'reader@example.com' }, { auth: false });
    expect(res.status).toBe(401);
    expect(dbMocks.upsertUserByEmail).not.toHaveBeenCalled();
  });
});

describe('POST /api/ingest/conversion', () => {
  const EVENT = {
    id: 'cv-1',
    friend_id: null,
    user_id: 'user-1',
    affiliate_id: 'aff-1',
    attributed_ref_code: 'mailmaga-0910',
    approval_status: 'pending',
  };

  it('resolves the person by email and records the conversion', async () => {
    dbMocks.trackConversion.mockResolvedValue(EVENT);

    const res = await post('/api/ingest/conversion', {
      conversionPointId: 'cp-consult',
      email: 'reader@example.com',
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: {
        id: 'cv-1',
        friendId: null,
        userId: 'user-1',
        affiliateId: 'aff-1',
        attributedRefCode: 'mailmaga-0910',
        approvalStatus: 'pending',
      },
    });
    expect(dbMocks.trackConversion).toHaveBeenCalledWith(
      env.DB,
      expect.objectContaining({ conversionPointId: 'cp-consult', userId: 'user-1', friendId: null }),
    );
  });

  it('passes an explicit friendId straight through without touching users', async () => {
    dbMocks.trackConversion.mockResolvedValue({ ...EVENT, friend_id: 'f-1', user_id: null });

    const res = await post('/api/ingest/conversion', {
      conversionPointId: 'cp-consult',
      friendId: 'f-1',
    });

    expect(res.status).toBe(200);
    expect(dbMocks.upsertUserByEmail).not.toHaveBeenCalled();
    expect(dbMocks.trackConversion).toHaveBeenCalledWith(
      env.DB,
      expect.objectContaining({ friendId: 'f-1', userId: null }),
    );
  });

  it('rejects a conversion with no identity at all', async () => {
    const res = await post('/api/ingest/conversion', { conversionPointId: 'cp-consult' });
    expect(res.status).toBe(400);
    expect(dbMocks.trackConversion).not.toHaveBeenCalled();
  });

  it('rejects a missing conversionPointId', async () => {
    const res = await post('/api/ingest/conversion', { email: 'reader@example.com' });
    expect(res.status).toBe(400);
    expect(dbMocks.trackConversion).not.toHaveBeenCalled();
  });

  it('requires authentication', async () => {
    const res = await post(
      '/api/ingest/conversion',
      { conversionPointId: 'cp-consult', friendId: 'f-1' },
      { auth: false },
    );
    expect(res.status).toBe(401);
  });
});
