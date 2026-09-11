import { Hono } from 'hono';
import { listPeople, type PeopleChannel } from '@line-crm/db';
import type { Env } from '../index.js';

/**
 * GET /api/people — LINE 友だちとメルマガ読者を1つの一覧で返す。
 *
 * 友だち管理の「すべて / LINE / メルマガ」切替の裏側。中身は db の listPeople。
 * ?channel=all|line|mail  ?search=  ?lineAccountId=  ?limit=  ?offset=  ?sort=recent|oldest
 */
const people = new Hono<Env>();

people.get('/api/people', async (c) => {
  try {
    const ch = c.req.query('channel');
    const channel: PeopleChannel | 'all' = ch === 'line' || ch === 'mail' ? ch : 'all';
    const result = await listPeople(c.env.DB, {
      channel,
      search: c.req.query('search') || undefined,
      lineAccountId: c.req.query('lineAccountId') || undefined,
      limit: Number(c.req.query('limit') ?? '20'),
      offset: Number(c.req.query('offset') ?? '0'),
      sort: c.req.query('sort') === 'oldest' ? 'oldest' : 'recent',
    });
    return c.json({
      success: true,
      data: {
        items: result.items.map((r) => ({
          channel: r.channel,
          id: r.id,
          displayName: r.display_name,
          pictureUrl: r.picture_url,
          email: r.email,
          lineAccountId: r.line_account_id,
          sourceLabel: r.source_label,
          joinedAt: r.joined_at,
        })),
        total: result.total,
        hasNextPage: result.hasNextPage,
      },
    });
  } catch (err) {
    console.error('GET /api/people error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { people };
