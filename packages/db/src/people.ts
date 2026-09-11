/**
 * People — LINE 友だちとメルマガ読者を1つの一覧として返す。
 *
 * 友だち管理の画面で「LINE / メルマガ」を横断して人を見るための読み出し口。
 * friends(LINE) と users(email を持つ人) を UNION して、チャネル列を付けて返す。
 *
 * ここで人を寄せているのではない。表示のために2つの表を並べて読むだけで、
 * 書き込みは一切しない。friends.user_id で紐づいた人は両方に出る
 * (LINE 友だちであり、メルマガ読者でもある。それは事実なので隠さない)。
 *
 * X / Threads / Instagram はここに出ない。人単位のデータが無い
 * (Threads は API にフォロワー一覧が無く、X は有料枠)。人数は audience のほう。
 */

export type PeopleChannel = 'line' | 'mail';

export interface PersonRow {
  channel: PeopleChannel;
  id: string;
  display_name: string | null;
  picture_url: string | null;
  email: string | null;
  line_account_id: string | null;
  source_label: string | null;
  joined_at: string;
}

export interface ListPeopleOptions {
  channel?: PeopleChannel | 'all';
  search?: string;
  lineAccountId?: string;
  limit?: number;
  offset?: number;
  sort?: 'recent' | 'oldest';
}

export interface ListPeopleResult {
  items: PersonRow[];
  total: number;
  hasNextPage: boolean;
}

// friends 側の列と users 側の列を同じ形に揃える。
// joined_at は「その名簿に入った日」。LINE は友だち追加日、メルマガは出どころでの
// 登録日 (subscribed_at)。無ければ取り込み日 (created_at) で代用する。
const LINE_SELECT = `
  SELECT 'line' AS channel, f.id AS id, f.display_name AS display_name, f.picture_url AS picture_url,
         NULL AS email, f.line_account_id AS line_account_id, NULL AS source_label,
         COALESCE(f.current_follow_started_at, f.first_followed_at, f.created_at) AS joined_at
    FROM friends f
   WHERE f.is_following = 1`;

const MAIL_SELECT = `
  SELECT 'mail' AS channel, u.id AS id, u.display_name AS display_name, NULL AS picture_url,
         u.email AS email, NULL AS line_account_id, u.source_label AS source_label,
         COALESCE(u.subscribed_at, u.created_at) AS joined_at
    FROM users u
   WHERE u.email IS NOT NULL AND u.email <> ''`;

export async function listPeople(
  db: D1Database,
  opts: ListPeopleOptions = {},
): Promise<ListPeopleResult> {
  const channel = opts.channel ?? 'all';
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const order = opts.sort === 'oldest' ? 'ASC' : 'DESC';
  const search = opts.search?.trim();

  const parts: string[] = [];
  const binds: unknown[] = [];

  if (channel === 'all' || channel === 'line') {
    let sql = LINE_SELECT;
    if (opts.lineAccountId) { sql += ` AND f.line_account_id = ?`; binds.push(opts.lineAccountId); }
    if (search) { sql += ` AND f.display_name LIKE ?`; binds.push(`%${search}%`); }
    parts.push(sql);
  }
  if (channel === 'all' || channel === 'mail') {
    let sql = MAIL_SELECT;
    // メルマガ読者は名前が無いことが多いので、検索は email にも当てる
    if (search) { sql += ` AND (u.display_name LIKE ? OR u.email LIKE ?)`; binds.push(`%${search}%`, `%${search}%`); }
    parts.push(sql);
  }
  if (parts.length === 0) return { items: [], total: 0, hasNextPage: false };

  const union = parts.join('\n  UNION ALL\n');

  const countRow = await db
    .prepare(`SELECT COUNT(*) AS n FROM (${union})`)
    .bind(...binds)
    .first<{ n: number }>();
  const total = countRow?.n ?? 0;

  const rows = await db
    .prepare(`SELECT * FROM (${union}) ORDER BY joined_at ${order}, id ${order} LIMIT ? OFFSET ?`)
    .bind(...binds, limit, offset)
    .all<PersonRow>();
  const items = rows.results ?? [];

  return { items, total, hasNextPage: offset + items.length < total };
}
