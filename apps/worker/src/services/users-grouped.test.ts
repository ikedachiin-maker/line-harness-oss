import { beforeEach, describe, expect, test } from 'vitest';
import { _resetCacheForTest, computeUsersGrouped } from './users-grouped.js';

type StubResult<T> = { results: T[] };

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
  data: string; // JSON
}

function stubDB(canned: { ident: IdentRow[]; forms: FormRow[] }) {
  return {
    prepare(sql: string) {
      const isForm = sql.includes('form_submissions');
      return {
        all: async (): Promise<StubResult<unknown>> => ({
          results: isForm ? canned.forms : canned.ident,
        }),
        first: async () => null,
        bind() {
          return this;
        },
      };
    },
  } as unknown as D1Database;
}

describe('computeUsersGrouped', () => {
  beforeEach(() => {
    _resetCacheForTest();
  });

  test('単一 friend は accounts.length=1 / isDuplicate=false の 1 行になる', async () => {
    const db = stubDB({
      ident: [
        {
          friend_id: 'f1',
          line_account_id: 'a1',
          account_name: 'L ①',
          line_user_id: 'U1',
          display_name: '山田',
          picture_url: 'https://sprofile.line-scdn.net/0hAbc123',
          is_following: 1,
          metadata: null,
          created_at: '2026-01-01T00:00:00+09:00',
          updated_at: '2026-01-02T00:00:00+09:00',
          ident_key:
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          ident_kind: 'url_token',
        },
      ],
      forms: [],
    });

    const result = await computeUsersGrouped(db);

    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(50);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      identityKey:
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      identityKeyKind: 'url_token',
      displayName: '山田',
      isDuplicate: false,
    });
    expect(result.rows[0].accounts).toHaveLength(1);
    expect(result.rows[0].accounts[0]).toMatchObject({
      accountId: 'a1',
      accountName: 'L ①',
      lineUserId: 'U1',
      isFollowing: true,
      friendId: 'f1',
    });
    expect(result.rows[0].xUsername).toBeNull();
    expect(result.rows[0].emails).toEqual([]);
    expect(result.rows[0].phones).toEqual([]);
    expect(typeof result.computedAt).toBe('string');
  });

  test('同じ ident_key の friend 2 件は accounts.length=2 / isDuplicate=true に集約される', async () => {
    const sharedKey = 'k_shared';
    const db = stubDB({
      ident: [
        {
          friend_id: 'f1',
          line_account_id: 'a1',
          account_name: 'L ①',
          line_user_id: 'U1',
          display_name: '山田',
          picture_url: 'https://sprofile.line-scdn.net/x',
          is_following: 1,
          metadata: null,
          created_at: '2026-01-01T00:00:00+09:00',
          updated_at: '2026-01-02T00:00:00+09:00',
          ident_key: sharedKey,
          ident_kind: 'url_token',
        },
        {
          friend_id: 'f2',
          line_account_id: 'a2',
          account_name: 'L ②',
          line_user_id: 'U2',
          display_name: '山田太郎',
          picture_url: 'https://sprofile.line-scdn.net/x',
          is_following: 1,
          metadata: null,
          created_at: '2026-02-01T00:00:00+09:00',
          updated_at: '2026-02-02T00:00:00+09:00',
          ident_key: sharedKey,
          ident_kind: 'url_token',
        },
      ],
      forms: [],
    });

    const result = await computeUsersGrouped(db);

    expect(result.total).toBe(1);
    expect(result.rows[0].isDuplicate).toBe(true);
    expect(result.rows[0].accounts).toHaveLength(2);
    // 最新 updated_at の friend が head になる
    expect(result.rows[0].displayName).toBe('山田太郎');
    const accountIds = result.rows[0].accounts.map((a) => a.accountId).sort();
    expect(accountIds).toEqual(['a1', 'a2']);
  });

  test('uid: フォールバックは別グループ、solo: は常にユニーク', async () => {
    const db = stubDB({
      ident: [
        {
          friend_id: 'f1',
          line_account_id: 'a1',
          account_name: 'L ①',
          line_user_id: 'U1',
          display_name: 'A',
          picture_url: null,
          is_following: 1,
          metadata: null,
          created_at: '2026-01-01T00:00:00+09:00',
          updated_at: '2026-01-01T00:00:00+09:00',
          ident_key: 'uid:U999',
          ident_kind: 'uid',
        },
        {
          friend_id: 'f2',
          line_account_id: 'a2',
          account_name: 'L ②',
          line_user_id: 'U2',
          display_name: 'A',
          picture_url: null,
          is_following: 1,
          metadata: null,
          created_at: '2026-01-02T00:00:00+09:00',
          updated_at: '2026-01-02T00:00:00+09:00',
          ident_key: 'uid:U999',
          ident_kind: 'uid',
        },
        {
          friend_id: 'f3',
          line_account_id: 'a1',
          account_name: 'L ①',
          line_user_id: 'U3',
          display_name: 'B',
          picture_url: null,
          is_following: 1,
          metadata: null,
          created_at: '2026-01-03T00:00:00+09:00',
          updated_at: '2026-01-03T00:00:00+09:00',
          ident_key: 'solo:f3',
          ident_kind: 'solo',
        },
      ],
      forms: [],
    });

    const result = await computeUsersGrouped(db);

    expect(result.total).toBe(2);
    const uidRow = result.rows.find((r) => r.identityKey === 'uid:U999');
    expect(uidRow?.identityKeyKind).toBe('uid');
    expect(uidRow?.accounts).toHaveLength(2);
    const soloRow = result.rows.find((r) => r.identityKey === 'solo:f3');
    expect(soloRow?.identityKeyKind).toBe('solo');
    expect(soloRow?.accounts).toHaveLength(1);
  });

  test('form_submissions から email/phone を抽出し重複排除する', async () => {
    const db = stubDB({
      ident: [
        {
          friend_id: 'f1',
          line_account_id: 'a1',
          account_name: 'L ①',
          line_user_id: 'U1',
          display_name: '山田',
          picture_url: null,
          is_following: 1,
          metadata: null,
          created_at: '2026-01-01T00:00:00+09:00',
          updated_at: '2026-01-01T00:00:00+09:00',
          ident_key: 'k1',
          ident_kind: 'url_token',
        },
      ],
      forms: [
        {
          friend_id: 'f1',
          data: JSON.stringify({ email: 'a@example.com', phone: '090-1111-2222' }),
        },
        {
          friend_id: 'f1',
          data: JSON.stringify({ email: 'a@example.com', tel: '090-3333-4444' }),
        },
        {
          friend_id: 'f1',
          data: JSON.stringify({ メール: 'b@example.com', 電話: '090-5555' }),
        },
      ],
    });

    const result = await computeUsersGrouped(db);
    const row = result.rows[0];
    expect(row.emails.sort()).toEqual(['a@example.com', 'b@example.com']);
    expect(row.phones.sort()).toEqual(['090-1111-2222', '090-3333-4444', '090-5555']);
  });

  test('metadata.x_username が抽出される（最初の非空を採用）', async () => {
    const db = stubDB({
      ident: [
        {
          friend_id: 'f1',
          line_account_id: 'a1',
          account_name: 'L ①',
          line_user_id: 'U1',
          display_name: '山田',
          picture_url: null,
          is_following: 1,
          metadata: JSON.stringify({ x_username: 'yamada' }),
          created_at: '2026-01-01T00:00:00+09:00',
          updated_at: '2026-01-02T00:00:00+09:00',
          ident_key: 'k1',
          ident_kind: 'url_token',
        },
        {
          friend_id: 'f2',
          line_account_id: 'a2',
          account_name: 'L ②',
          line_user_id: 'U2',
          display_name: '山田',
          picture_url: null,
          is_following: 1,
          metadata: JSON.stringify({ x_username: 'yamada_alt' }),
          created_at: '2026-01-01T00:00:00+09:00',
          updated_at: '2026-01-01T00:00:00+09:00',
          ident_key: 'k1',
          ident_kind: 'url_token',
        },
      ],
      forms: [],
    });

    const result = await computeUsersGrouped(db);
    // head は updated_at が新しい f1 → x_username='yamada'
    expect(result.rows[0].xUsername).toBe('yamada');
  });

  test('form 提出に x_username があれば拾う（save_to_metadata=0 のフォーム対応）', async () => {
    const db = stubDB({
      ident: [
        {
          friend_id: 'f1',
          line_account_id: 'a1',
          account_name: 'L ①',
          line_user_id: 'U1',
          display_name: '山田',
          picture_url: null,
          is_following: 1,
          metadata: null,
          created_at: '2026-01-01T00:00:00+09:00',
          updated_at: '2026-01-01T00:00:00+09:00',
          ident_key: 'k1',
          ident_kind: 'url_token',
        },
      ],
      forms: [{ friend_id: 'f1', data: JSON.stringify({ x_username: '@yamada_x' }) }],
    });

    const result = await computeUsersGrouped(db);
    // 先頭の @ は剥がす
    expect(result.rows[0].xUsername).toBe('yamada_x');
  });

  test('同じ line_account_id に複数 friend 行があっても accounts は distinct アカウント数', async () => {
    // block → 再フォローで同一アカウント内に 2 friend 行が出来るケース
    const db = stubDB({
      ident: [
        {
          friend_id: 'f1_old',
          line_account_id: 'a1',
          account_name: 'L ①',
          line_user_id: 'U1_old',
          display_name: '山田',
          picture_url: null,
          is_following: 1,
          metadata: null,
          created_at: '2026-01-01T00:00:00+09:00',
          updated_at: '2026-01-01T00:00:00+09:00',
          ident_key: 'k1',
          ident_kind: 'url_token',
        },
        {
          friend_id: 'f1_new',
          line_account_id: 'a1',
          account_name: 'L ①',
          line_user_id: 'U1_new',
          display_name: '山田',
          picture_url: null,
          is_following: 1,
          metadata: null,
          created_at: '2026-02-01T00:00:00+09:00',
          updated_at: '2026-02-01T00:00:00+09:00',
          ident_key: 'k1',
          ident_kind: 'url_token',
        },
      ],
      forms: [],
    });

    const result = await computeUsersGrouped(db);
    expect(result.rows[0].accounts).toHaveLength(1);
    expect(result.rows[0].accounts[0].friendId).toBe('f1_new'); // 最新が残る
    expect(result.rows[0].isDuplicate).toBe(false);
  });

  test('metadata の x_username は form より優先される', async () => {
    const db = stubDB({
      ident: [
        {
          friend_id: 'f1',
          line_account_id: 'a1',
          account_name: 'L ①',
          line_user_id: 'U1',
          display_name: '山田',
          picture_url: null,
          is_following: 1,
          metadata: JSON.stringify({ x_username: 'meta_handle' }),
          created_at: '2026-01-01T00:00:00+09:00',
          updated_at: '2026-01-01T00:00:00+09:00',
          ident_key: 'k1',
          ident_kind: 'url_token',
        },
      ],
      forms: [{ friend_id: 'f1', data: JSON.stringify({ x_username: 'form_handle' }) }],
    });

    const result = await computeUsersGrouped(db);
    expect(result.rows[0].xUsername).toBe('meta_handle');
  });

  test('壊れた JSON metadata / data は無視される（throwしない）', async () => {
    const db = stubDB({
      ident: [
        {
          friend_id: 'f1',
          line_account_id: 'a1',
          account_name: 'L ①',
          line_user_id: 'U1',
          display_name: '山田',
          picture_url: null,
          is_following: 1,
          metadata: '{not json',
          created_at: '2026-01-01T00:00:00+09:00',
          updated_at: '2026-01-01T00:00:00+09:00',
          ident_key: 'k1',
          ident_kind: 'url_token',
        },
      ],
      forms: [{ friend_id: 'f1', data: '{also not json' }],
    });

    const result = await computeUsersGrouped(db);
    expect(result.rows[0].xUsername).toBeNull();
    expect(result.rows[0].emails).toEqual([]);
    expect(result.rows[0].phones).toEqual([]);
  });

  function makeRow(
    i: number,
    identKey: string,
    accounts: { id: string; name: string }[],
  ): IdentRow[] {
    return accounts.map((acc, j) => ({
      friend_id: `f${i}_${j}`,
      line_account_id: acc.id,
      account_name: acc.name,
      line_user_id: `U${i}_${j}`,
      display_name: `User${i}`,
      picture_url: null,
      is_following: 1,
      metadata: null,
      created_at: `2026-01-${String(i).padStart(2, '0')}T00:00:00+09:00`,
      updated_at: `2026-01-${String(i).padStart(2, '0')}T00:00:00+09:00`,
      ident_key: identKey,
      ident_kind: 'url_token' as const,
    }));
  }

  test('onlyDups=true は accounts.length>=2 のみ返す', async () => {
    const db = stubDB({
      ident: [
        ...makeRow(1, 'k1', [
          { id: 'a1', name: 'L ①' },
          { id: 'a2', name: 'L ②' },
        ]),
        ...makeRow(2, 'k2', [{ id: 'a1', name: 'L ①' }]),
      ],
      forms: [],
    });

    const result = await computeUsersGrouped(db, { onlyDups: true });
    expect(result.total).toBe(1);
    expect(result.rows[0].identityKey).toBe('k1');
  });

  test('account フィルタはそのアカウントに居る人だけ返す', async () => {
    const db = stubDB({
      ident: [
        ...makeRow(1, 'k1', [{ id: 'a1', name: 'L ①' }]),
        ...makeRow(2, 'k2', [{ id: 'a2', name: 'L ②' }]),
        ...makeRow(3, 'k3', [
          { id: 'a1', name: 'L ①' },
          { id: 'a2', name: 'L ②' },
        ]),
      ],
      forms: [],
    });

    const result = await computeUsersGrouped(db, { account: 'a1' });
    expect(result.total).toBe(2);
    const keys = result.rows.map((r) => r.identityKey).sort();
    expect(keys).toEqual(['k1', 'k3']);
  });

  test('q 検索は displayName / xUsername / email / phone / lineUserId / identityKey 先頭を見る', async () => {
    const db = stubDB({
      ident: [
        {
          ...makeRow(1, 'kabc', [{ id: 'a1', name: 'L ①' }])[0],
          display_name: '山田太郎',
          metadata: JSON.stringify({ x_username: 'yamada' }),
        },
        {
          ...makeRow(2, 'kdef', [{ id: 'a1', name: 'L ①' }])[0],
          display_name: '佐藤',
          line_user_id: 'Uspecial',
        },
      ],
      forms: [{ friend_id: 'f1_0', data: JSON.stringify({ email: 'taro@x.com' }) }],
    });

    expect((await computeUsersGrouped(db, { q: '山田' })).total).toBe(1);
    expect((await computeUsersGrouped(db, { q: 'YAMADA' })).total).toBe(1);
    // 先頭の @ は剥がして xUsername と突き合わせる（`@yamada` でも当たる）
    expect((await computeUsersGrouped(db, { q: '@yamada' })).total).toBe(1);
    expect((await computeUsersGrouped(db, { q: 'taro@' })).total).toBe(1);
    expect((await computeUsersGrouped(db, { q: 'special' })).total).toBe(1);
    expect((await computeUsersGrouped(db, { q: 'kabc' })).total).toBe(1);
    expect((await computeUsersGrouped(db, { q: 'no-hit' })).total).toBe(0);
  });

  test('ページネーション: page と pageSize で切り出される', async () => {
    const ident: IdentRow[] = [];
    for (let i = 1; i <= 7; i++) {
      ident.push(...makeRow(i, `k${i}`, [{ id: 'a1', name: 'L ①' }]));
    }
    const db = stubDB({ ident, forms: [] });

    const p1 = await computeUsersGrouped(db, { page: 1, pageSize: 3 });
    expect(p1.total).toBe(7);
    expect(p1.page).toBe(1);
    expect(p1.pageSize).toBe(3);
    expect(p1.rows).toHaveLength(3);

    const p3 = await computeUsersGrouped(db, { page: 3, pageSize: 3 });
    expect(p3.rows).toHaveLength(1);
  });

  test('ソート: 重複が多い順 → lastActivityAt 降順', async () => {
    const db = stubDB({
      ident: [
        {
          ...makeRow(1, 'k1', [{ id: 'a1', name: 'L ①' }])[0],
          updated_at: '2026-01-01T00:00:00+09:00',
        },
        {
          ...makeRow(2, 'k2', [{ id: 'a1', name: 'L ①' }])[0],
          updated_at: '2026-03-01T00:00:00+09:00',
        },
        ...makeRow(3, 'k3', [
          { id: 'a1', name: 'L ①' },
          { id: 'a2', name: 'L ②' },
        ]).map((r) => ({
          ...r,
          updated_at: '2026-02-01T00:00:00+09:00',
        })),
      ],
      forms: [],
    });

    const result = await computeUsersGrouped(db);
    expect(result.rows.map((r) => r.identityKey)).toEqual(['k3', 'k2', 'k1']);
  });

  test('TTL 内は DB を再クエリしない / forceRefresh で再クエリ', async () => {
    let identCalls = 0;
    const db = {
      prepare(sql: string) {
        const isForm = sql.includes('form_submissions');
        return {
          all: async () => {
            if (!isForm) identCalls++;
            return {
              results: isForm
                ? []
                : [
                    {
                      friend_id: 'f1',
                      line_account_id: 'a1',
                      account_name: 'L ①',
                      line_user_id: 'U1',
                      display_name: '山田',
                      picture_url: null,
                      is_following: 1,
                      metadata: null,
                      created_at: '2026-01-01T00:00:00+09:00',
                      updated_at: '2026-01-01T00:00:00+09:00',
                      ident_key: 'k1',
                      ident_kind: 'url_token',
                    },
                  ],
            };
          },
          first: async () => null,
          bind() {
            return this;
          },
        };
      },
    } as unknown as D1Database;

    await computeUsersGrouped(db);
    await computeUsersGrouped(db);
    expect(identCalls).toBe(1);

    await computeUsersGrouped(db, { forceRefresh: true });
    expect(identCalls).toBe(2);
  });

  test('空結果はキャッシュされない（誤検知マスクを避ける）', async () => {
    let identCalls = 0;
    const db = {
      prepare(sql: string) {
        const isForm = sql.includes('form_submissions');
        return {
          all: async () => {
            if (!isForm) identCalls++;
            return { results: [] };
          },
          first: async () => null,
          bind() {
            return this;
          },
        };
      },
    } as unknown as D1Database;

    await computeUsersGrouped(db);
    await computeUsersGrouped(db);
    // 1 呼び出しで ident クエリは 1 回。空結果はキャッシュしないので、2 呼び出し = 2 回。
    expect(identCalls).toBe(2);
  });
});
