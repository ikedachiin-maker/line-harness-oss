export interface StepLike {
  template_id: string | null;
  message_type: string;
  message_content: string;
}

export interface ResolvedContent {
  messageType: string;
  messageContent: string;
  /** 実際に配信時に使った template_id (null = step 直接値を使った) */
  templateIdAtSend: string | null;
}

/**
 * テンプレ message_type を scenario_steps の CHECK 制約 ('text','image','flex') に
 * 合わせて正規化する。templates テーブルには 'carousel' も存在するが、scenario の
 * buildMessage() は text/image/flex しか扱えないため flex (carousel は Flex の特殊形)
 * に coerce する。
 */
function normalizeMessageType(type: string): string {
  if (type === 'carousel') return 'flex';
  return type;
}

/**
 * step.template_id がセットされていれば templates テーブルから内容を resolve。
 * テンプレが見つからない (削除直後のレース等) は step 側にフォールバックして配信を止めない。
 */
export async function resolveStepContent(
  db: D1Database,
  step: StepLike,
): Promise<ResolvedContent> {
  if (!step.template_id) {
    return {
      messageType: step.message_type,
      messageContent: step.message_content,
      templateIdAtSend: null,
    };
  }
  const tpl = await db
    .prepare('SELECT message_type, message_content FROM templates WHERE id = ?')
    .bind(step.template_id)
    .first<{ message_type: string; message_content: string }>();
  if (!tpl) {
    return {
      messageType: step.message_type,
      messageContent: step.message_content,
      templateIdAtSend: null,
    };
  }
  return {
    messageType: normalizeMessageType(tpl.message_type),
    messageContent: tpl.message_content,
    templateIdAtSend: step.template_id,
  };
}
