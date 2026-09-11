import {
  recordAudienceSnapshot,
  countLineFriendsByAccount,
  jstToday,
} from '@line-crm/db';

/**
 * 各チャネルの名簿規模を1日1回集める。
 *
 * 集め方は2通りある:
 *   self … 自分の DB を数える (LINE の友だち数)
 *   poll … 相手のハーネスの GET /api/audience を叩く (X / IG / Threads / メール)
 *
 * 叩けない相手 (UTAGE のように認証の形が違うもの) はここには来ない。
 * 向こうから POST /api/audience/report で送り込んでもらう。
 *
 * 名簿そのものは取りに行かない。持ってくるのは人数だけ。人の正本を動かすと
 * 同じ人が2箇所に存在してしまう。
 */

/**
 * cron の発火時刻 (UTC) を JST の「時」に直す。
 *
 * Workers の cron は UTC で走るので、JST の深夜に寄せたい判定はここを通す。
 * Date 側の getHours() はランタイムのタイムゾーンに依存して当てにならない。
 */
export function jstHour(scheduledTime: number | string | Date): number {
  const t = new Date(scheduledTime).getTime();
  return new Date(t + 9 * 60 * 60_000).getUTCHours();
}

/** 相手ハーネスが返す想定の形。5本で揃えている。 */
export interface AudienceReport {
  channel?: string;
  accounts?: { key?: string; accountKey?: string; label?: string | null; total?: number }[];
}

export interface HarnessSource {
  channel: string;
  url?: string;
  apiKey?: string;
  /**
   * 同一アカウントの Worker を呼ぶための service binding。
   *
   * **Cloudflare は、同じアカウントの Worker から `*.workers.dev` への
   * subrequest に 404 を返す。**外から curl すると 200 なのに、
   * line-harness の中から fetch したときだけ 404 になる。ここに
   * 気づかないと「相手が落ちている」と誤診する(2026-09-11 に踏んだ)。
   *
   * 兄弟ハーネスが同じアカウントに居るときは binding を渡す。
   * 別アカウント・別ホスティングの相手は今まで通り url で叩く。
   */
  fetcher?: { fetch: typeof fetch };
}

export interface CollectResult {
  recorded: number;
  failures: { channel: string; reason: string }[];
}

/** 相手が落ちていても他のチャネルを巻き込まないよう、1本ずつ切り離して扱う。 */
async function fetchAudience(
  source: HarnessSource,
  timeoutMs: number,
): Promise<AudienceReport> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // service binding があるときは URL のホスト名は使われない(binding が宛先)。
    // ただし fetch には絶対 URL が要るので、url が無いときだけ置き場所を作る。
    const base = (source.url ?? 'https://harness.invalid').replace(/\/$/, '');
    const call = source.fetcher ? source.fetcher.fetch.bind(source.fetcher) : fetch;
    const res = await call(`${base}/api/audience`, {
      headers: { Authorization: `Bearer ${source.apiKey!}` },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { success?: boolean; data?: AudienceReport };
    if (body.success === false || !body.data) throw new Error('unexpected response shape');
    return body.data;
  } finally {
    clearTimeout(timer);
  }
}

export async function collectAudience(
  db: D1Database,
  sources: HarnessSource[],
  opts: { today?: string; timeoutMs?: number } = {},
): Promise<CollectResult> {
  const capturedOn = opts.today ?? jstToday();
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const failures: CollectResult['failures'] = [];
  let recorded = 0;

  // LINE は自分の DB。外に出ないので必ず取れる。
  try {
    for (const account of await countLineFriendsByAccount(db)) {
      await recordAudienceSnapshot(db, {
        channel: 'line',
        accountKey: account.accountKey,
        accountLabel: account.accountLabel,
        total: account.total,
        source: 'self',
        capturedOn,
      });
      recorded++;
    }
  } catch (err) {
    failures.push({ channel: 'line', reason: err instanceof Error ? err.message : String(err) });
  }

  const configured = sources.filter((s) => (s.url || s.fetcher) && s.apiKey);
  const results = await Promise.allSettled(
    configured.map(async (source) => {
      const report = await fetchAudience(source, timeoutMs);
      const channel = report.channel || source.channel;
      let n = 0;
      for (const account of report.accounts ?? []) {
        const accountKey = account.accountKey ?? account.key;
        // key の無い行は系列を特定できない。取り込むと毎日別行になって
        // 差分が出せなくなるので落とす。
        if (!accountKey || typeof account.total !== 'number') continue;
        await recordAudienceSnapshot(db, {
          channel,
          accountKey,
          accountLabel: account.label ?? null,
          total: account.total,
          source: 'poll',
          capturedOn,
        });
        n++;
      }
      return n;
    }),
  );

  results.forEach((result, i) => {
    if (result.status === 'fulfilled') recorded += result.value;
    else {
      failures.push({
        channel: configured[i].channel,
        reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }
  });

  return { recorded, failures };
}

/** env から設定済みのハーネスだけを取り出す。未設定は静かに飛ばす。 */
export function harnessSourcesFromEnv(env: {
  X_HARNESS_URL?: string;
  X_HARNESS_API_KEY?: string;
  X_HARNESS_SERVICE?: { fetch: typeof fetch };
  IG_HARNESS_URL?: string;
  IG_HARNESS_API_KEY?: string;
  IG_HARNESS_SERVICE?: { fetch: typeof fetch };
  THREADS_HARNESS_URL?: string;
  THREADS_HARNESS_API_KEY?: string;
  THREADS_HARNESS_SERVICE?: { fetch: typeof fetch };
  MAIL_HARNESS_URL?: string;
  MAIL_HARNESS_API_KEY?: string;
  MAIL_HARNESS_SERVICE?: { fetch: typeof fetch };
}): HarnessSource[] {
  return [
    {
      channel: 'x',
      url: env.X_HARNESS_URL,
      apiKey: env.X_HARNESS_API_KEY,
      fetcher: env.X_HARNESS_SERVICE,
    },
    {
      channel: 'instagram',
      url: env.IG_HARNESS_URL,
      apiKey: env.IG_HARNESS_API_KEY,
      fetcher: env.IG_HARNESS_SERVICE,
    },
    {
      channel: 'threads',
      url: env.THREADS_HARNESS_URL,
      apiKey: env.THREADS_HARNESS_API_KEY,
      fetcher: env.THREADS_HARNESS_SERVICE,
    },
    {
      channel: 'mail',
      url: env.MAIL_HARNESS_URL,
      apiKey: env.MAIL_HARNESS_API_KEY,
      fetcher: env.MAIL_HARNESS_SERVICE,
    },
  ];
}
