import { URL_TOKEN_SQL } from '../lib/url-token.js';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const CACHE_TTL_MS = 5 * 60 * 1000;

const IDENT_KIND_SQL = `
  CASE
    WHEN (${URL_TOKEN_SQL}) IS NOT NULL THEN 'url_token'
    WHEN friends.user_id IS NOT NULL THEN 'uid'
    ELSE 'solo'
  END
`;

const IDENTITY_KEY_SQL = `
  COALESCE(
    ${URL_TOKEN_SQL},
    'uid:' || friends.user_id,
    'solo:' || friends.id
  )
`;

const IDENT_SQL = `
  SELECT
    friends.id           AS friend_id,
    friends.line_account_id,
    line_accounts.name   AS account_name,
    friends.line_user_id,
    friends.display_name,
    friends.picture_url,
    friends.is_following,
    friends.metadata,
    friends.created_at,
    friends.updated_at,
    (${IDENTITY_KEY_SQL}) AS ident_key,
    (${IDENT_KIND_SQL})   AS ident_kind
  FROM friends
  JOIN line_accounts ON line_accounts.id = friends.line_account_id
  WHERE friends.is_following = 1 AND line_accounts.is_active = 1
`;

// ORDER BY created_at DESC — 同じ friend が複数回フォーム送信した場合、
// 最新の x_username が優先される（順序指定なしだと SQLite の行順は未定義）。
// active な following friend に紐付くものだけに絞る — 退会済み・非アクティブ
// アカウント分の歴史的フォーム提出を毎回 JSON.parse する CPU コストを避ける。
const FORMS_SQL = `
  SELECT fs.friend_id, fs.data, fs.created_at
  FROM form_submissions fs
  JOIN friends f ON f.id = fs.friend_id
  JOIN line_accounts la ON la.id = f.line_account_id
  WHERE f.is_following = 1 AND la.is_active = 1
  ORDER BY fs.created_at DESC
`;

export interface AccountMembership {
  accountId: string;
  accountName: string;
  lineUserId: string;
  isFollowing: boolean;
  joinedAt: string;
  friendId: string;
}

export interface UnifiedUserRow {
  identityKey: string;
  identityKeyKind: 'url_token' | 'uid' | 'solo';
  displayName: string | null;
  pictureUrl: string | null;
  accounts: AccountMembership[];
  xUsername: string | null;
  emails: string[];
  phones: string[];
  lastActivityAt: string;
  isDuplicate: boolean;
}

export interface UsersGroupedResult {
  total: number;
  page: number;
  pageSize: number;
  rows: UnifiedUserRow[];
  computedAt: string;
}

export interface UsersGroupedOptions {
  q?: string;
  onlyDups?: boolean;
  account?: string;
  page?: number;
  pageSize?: number;
  forceRefresh?: boolean;
}

interface IdentRow {
  friend_id: string;
  line_account_id: string;
  account_name: string;
  line_user_id: string;
  display_name: string | null;
  picture_url: string | null;
  is_following: number;
  metadata: string | null;
  created_at: string;
  updated_at: string;
  ident_key: string;
  ident_kind: 'url_token' | 'uid' | 'solo';
}

interface FormRow {
  friend_id: string;
  data: string;
  created_at: string;
}

let cached: { rows: UnifiedUserRow[]; at: number } | null = null;

export function _resetCacheForTest(): void {
  cached = null;
}

async function computeAllRows(db: D1Database): Promise<UnifiedUserRow[]> {
  const identResult = await db.prepare(IDENT_SQL).all<IdentRow>();
  const formsResult = await db.prepare(FORMS_SQL).all<FormRow>();

  const formByFriend = new Map<string, FormRow[]>();
  for (const row of formsResult.results ?? []) {
    const list = formByFriend.get(row.friend_id) ?? [];
    list.push(row);
    formByFriend.set(row.friend_id, list);
  }

  const groups = new Map<string, IdentRow[]>();
  for (const row of identResult.results ?? []) {
    const list = groups.get(row.ident_key) ?? [];
    list.push(row);
    groups.set(row.ident_key, list);
  }

  const rows: UnifiedUserRow[] = [];
  for (const [identKey, members] of groups) {
    members.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    const head = members[0];

    // 同じ line_account_id に複数 friend 行がある場合（block→再フォロー等）、
    // 最新の updated_at の行だけを残す。distinct account 数 = accounts.length となり
    // /duplicates の COUNT(DISTINCT line_account_id) と一致する。
    const seenAccount = new Set<string>();
    const accounts: AccountMembership[] = [];
    for (const m of members) {
      if (seenAccount.has(m.line_account_id)) continue;
      seenAccount.add(m.line_account_id);
      accounts.push({
        accountId: m.line_account_id,
        accountName: m.account_name,
        lineUserId: m.line_user_id,
        isFollowing: m.is_following === 1,
        joinedAt: m.created_at,
        friendId: m.friend_id,
      });
    }

    let xUsername: string | null = null;
    const emails = new Set<string>();
    const phones = new Set<string>();

    for (const m of members) {
      if (!xUsername && m.metadata) {
        try {
          const meta = JSON.parse(m.metadata);
          if (typeof meta?.x_username === 'string' && meta.x_username) {
            xUsername = meta.x_username;
          }
        } catch {
          // malformed metadata — ignore
        }
      }
      const submissions = formByFriend.get(m.friend_id) ?? [];
      for (const sub of submissions) {
        try {
          const data = JSON.parse(sub.data) as Record<string, unknown>;
          // x_username は metadata に無くても form 提出から拾う
          // (save_to_metadata=0 のフォームでも漏らさないため)
          if (!xUsername && typeof data.x_username === 'string' && data.x_username) {
            xUsername = data.x_username.replace(/^@/, '');
          }
          for (const [key, val] of Object.entries(data)) {
            if (typeof val !== 'string' || !val) continue;
            const k = key.toLowerCase();
            // 英: email/mail / 日: メール
            if (k.includes('email') || k.includes('mail') || k.includes('メール')) {
              emails.add(val);
            // 英: phone/tel / 日: 電話
            } else if (k.includes('phone') || k.includes('tel') || k.includes('電話')) {
              phones.add(val);
            }
          }
        } catch {
          // malformed data — ignore
        }
      }
    }

    rows.push({
      identityKey: identKey,
      identityKeyKind: head.ident_kind,
      displayName: head.display_name,
      pictureUrl: head.picture_url,
      accounts,
      xUsername,
      emails: [...emails],
      phones: [...phones],
      lastActivityAt: head.updated_at,
      isDuplicate: accounts.length >= 2,
    });
  }

  rows.sort((a, b) => {
    if (a.accounts.length !== b.accounts.length) return b.accounts.length - a.accounts.length;
    return b.lastActivityAt.localeCompare(a.lastActivityAt);
  });

  return rows;
}

function applyFilters(rows: UnifiedUserRow[], opts: UsersGroupedOptions): UnifiedUserRow[] {
  let filtered = rows;
  if (opts.onlyDups) {
    filtered = filtered.filter((r) => r.isDuplicate);
  }
  if (opts.account) {
    filtered = filtered.filter((r) => r.accounts.some((a) => a.accountId === opts.account));
  }
  if (opts.q) {
    const q = opts.q.toLowerCase();
    // 行は xUsername を `@yamada` で表示するので、コピペ検索 `@yamada` も `yamada` と
    // 同じく当てたい。@ は X handle に含まれない文字なので一律剥がして問題ない。
    const qNoAt = q.replace(/^@/, '');
    filtered = filtered.filter((r) => {
      if (r.displayName?.toLowerCase().includes(q)) return true;
      if (r.xUsername?.toLowerCase().includes(qNoAt)) return true;
      if (r.identityKey.toLowerCase().startsWith(q)) return true;
      if (r.emails.some((e) => e.toLowerCase().includes(q))) return true;
      if (r.phones.some((p) => p.includes(q))) return true;
      if (r.accounts.some((a) => a.lineUserId.toLowerCase().includes(q))) return true;
      return false;
    });
  }
  return filtered;
}

export async function computeUsersGrouped(
  db: D1Database,
  opts: UsersGroupedOptions = {},
): Promise<UsersGroupedResult> {
  let allRows: UnifiedUserRow[];
  if (!opts.forceRefresh && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    allRows = cached.rows;
  } else {
    allRows = await computeAllRows(db);
    if (allRows.length > 0) {
      cached = { rows: allRows, at: Date.now() };
    } else {
      cached = null;
    }
  }

  const filtered = applyFilters(allRows, opts);
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, opts.pageSize ?? DEFAULT_PAGE_SIZE));
  const start = (page - 1) * pageSize;
  const slice = filtered.slice(start, start + pageSize);

  return {
    total: filtered.length,
    page,
    pageSize,
    rows: slice,
    computedAt: new Date().toISOString(),
  };
}
