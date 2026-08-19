import { jstNow } from './utils.js';
// テンプレート管理クエリヘルパー

export interface TemplateRow {
  id: string;
  name: string;
  category: string;
  message_type: string;
  message_content: string;
  created_at: string;
  updated_at: string;
}

export async function getTemplates(db: D1Database, category?: string): Promise<TemplateRow[]> {
  if (category) {
    const result = await db.prepare(`SELECT * FROM templates WHERE category = ? ORDER BY created_at DESC`)
      .bind(category).all<TemplateRow>();
    return result.results;
  }
  const result = await db.prepare(`SELECT * FROM templates ORDER BY created_at DESC`).all<TemplateRow>();
  return result.results;
}

export async function getTemplateById(db: D1Database, id: string): Promise<TemplateRow | null> {
  return db.prepare(`SELECT * FROM templates WHERE id = ?`).bind(id).first<TemplateRow>();
}

export async function createTemplate(
  db: D1Database,
  input: { name: string; category?: string; messageType: string; messageContent: string },
): Promise<TemplateRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db.prepare(`INSERT INTO templates (id, name, category, message_type, message_content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, input.name, input.category ?? 'general', input.messageType, input.messageContent, now, now).run();
  return (await getTemplateById(db, id))!;
}

export async function updateTemplate(
  db: D1Database,
  id: string,
  updates: Partial<{ name: string; category: string; messageType: string; messageContent: string }>,
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (updates.name !== undefined) { sets.push('name = ?'); values.push(updates.name); }
  if (updates.category !== undefined) { sets.push('category = ?'); values.push(updates.category); }
  if (updates.messageType !== undefined) { sets.push('message_type = ?'); values.push(updates.messageType); }
  if (updates.messageContent !== undefined) { sets.push('message_content = ?'); values.push(updates.messageContent); }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  values.push(jstNow());
  values.push(id);
  await db.prepare(`UPDATE templates SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
}

export async function deleteTemplate(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM templates WHERE id = ?`).bind(id).run();
}

export interface TemplateUsage {
  autoReplies: Array<{
    id: string;
    keyword: string;
    matchType: 'exact' | 'contains';
    lineAccountId: string | null;
  }>;
  automations: Array<{
    id: string;
    name: string;
    eventType: string;
  }>;
}

/**
 * Template の参照箇所を返す。
 * - auto_replies: template_id が一致する row
 * - automations: actions JSON 内に "template_id":"<id>" を含む row (LIKE 検索)
 *   automations は数十件規模なので LIKE で十分高速。
 */
export async function getTemplateUsage(db: D1Database, templateId: string): Promise<TemplateUsage> {
  const arRes = await db
    .prepare(
      `SELECT id, keyword, match_type, line_account_id
       FROM auto_replies WHERE template_id = ? ORDER BY created_at DESC`,
    )
    .bind(templateId)
    .all<{ id: string; keyword: string; match_type: 'exact' | 'contains'; line_account_id: string | null }>();

  // automations の actions JSON を全件取って JS 側で template_id をマッチさせる。
  // SQL LIKE で "%\"template_id\":\"<id>\"%" を投げると D1 SQLite の
  // "pattern too complex" 上限に当たるので JS 処理にしている。
  const autRes = await db
    .prepare(`SELECT id, name, event_type, actions FROM automations ORDER BY created_at DESC`)
    .all<{ id: string; name: string; event_type: string; actions: string }>();
  const matchedAutomations: Array<{ id: string; name: string; event_type: string }> = [];
  for (const r of autRes.results ?? []) {
    try {
      const actions = JSON.parse(r.actions) as Array<{ params?: { template_id?: string } }>;
      if (actions.some((a) => a.params?.template_id === templateId)) {
        matchedAutomations.push({ id: r.id, name: r.name, event_type: r.event_type });
      }
    } catch {
      // ignore malformed
    }
  }

  return {
    autoReplies: (arRes.results ?? []).map((r) => ({
      id: r.id,
      keyword: r.keyword,
      matchType: r.match_type,
      lineAccountId: r.line_account_id,
    })),
    automations: matchedAutomations.map((r) => ({
      id: r.id,
      name: r.name,
      eventType: r.event_type,
    })),
  };
}

export interface TemplateRowWithUsage extends TemplateRow {
  usage_count: number;
}

/**
 * 一覧画面用に template + 使用数を返す。
 * - auto_replies は indexed lookup (1 SQL)
 * - automations は actions JSON 全件取って JS で template_id を抽出 (LIKE が
 *   D1 SQLite の "pattern too complex" 上限に当たるので避ける)
 */
export async function getTemplatesWithUsageCount(
  db: D1Database,
  category?: string,
): Promise<TemplateRowWithUsage[]> {
  // 1. templates 本体
  const tplSql = category
    ? `SELECT * FROM templates WHERE category = ? ORDER BY created_at DESC`
    : `SELECT * FROM templates ORDER BY created_at DESC`;
  const tplStmt = category ? db.prepare(tplSql).bind(category) : db.prepare(tplSql);
  const templates = await tplStmt.all<TemplateRow>();

  // 2. auto_replies の template_id 別カウント (NOT NULL のみ)
  const arRes = await db
    .prepare(`SELECT template_id, COUNT(*) AS cnt FROM auto_replies WHERE template_id IS NOT NULL GROUP BY template_id`)
    .all<{ template_id: string; cnt: number }>();
  const autoReplyCount = new Map<string, number>();
  for (const r of arRes.results ?? []) autoReplyCount.set(r.template_id, r.cnt);

  // 3. automations の actions JSON を取って template_id を抽出
  const autRes = await db
    .prepare(`SELECT actions FROM automations`)
    .all<{ actions: string }>();
  const automationCount = new Map<string, number>();
  for (const r of autRes.results ?? []) {
    try {
      const actions = JSON.parse(r.actions) as Array<{ params?: { template_id?: string } }>;
      for (const a of actions) {
        const tid = a.params?.template_id;
        if (tid) automationCount.set(tid, (automationCount.get(tid) ?? 0) + 1);
      }
    } catch {
      // ignore malformed JSON rows
    }
  }

  // 4. scenario_steps の template_id 別カウント
  const ssRes = await db
    .prepare(`SELECT template_id, COUNT(*) AS cnt FROM scenario_steps WHERE template_id IS NOT NULL GROUP BY template_id`)
    .all<{ template_id: string; cnt: number }>();
  const scenarioStepCount = new Map<string, number>();
  for (const r of ssRes.results ?? []) scenarioStepCount.set(r.template_id, r.cnt);

  return (templates.results ?? []).map((t) => ({
    ...t,
    usage_count: (autoReplyCount.get(t.id) ?? 0) + (automationCount.get(t.id) ?? 0) + (scenarioStepCount.get(t.id) ?? 0),
  }));
}
