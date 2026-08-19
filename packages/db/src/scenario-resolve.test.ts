import { describe, it, expect } from 'vitest';
import { resolveStepContent } from './scenario-resolve.js';

function mockDb(tplRow: { message_type: string; message_content: string } | null): D1Database {
  return {
    prepare: () => ({
      bind: () => ({
        first: async () => tplRow,
      }),
    }),
  } as unknown as D1Database;
}

describe('resolveStepContent', () => {
  it('template_id=null → step の値を返す', async () => {
    const result = await resolveStepContent(mockDb(null), {
      template_id: null,
      message_type: 'text',
      message_content: 'hello',
    });
    expect(result).toEqual({
      messageType: 'text',
      messageContent: 'hello',
      templateIdAtSend: null,
    });
  });

  it('template_id がある + テンプレが存在 → テンプレ値を返す', async () => {
    const result = await resolveStepContent(
      mockDb({ message_type: 'flex', message_content: '{"foo":"bar"}' }),
      {
        template_id: 'tpl-1',
        message_type: 'text',
        message_content: 'fallback',
      },
    );
    expect(result).toEqual({
      messageType: 'flex',
      messageContent: '{"foo":"bar"}',
      templateIdAtSend: 'tpl-1',
    });
  });

  it('template_id がある + テンプレが見つからない → step 値にフォールバック', async () => {
    const result = await resolveStepContent(mockDb(null), {
      template_id: 'tpl-deleted',
      message_type: 'text',
      message_content: 'fallback',
    });
    expect(result).toEqual({
      messageType: 'text',
      messageContent: 'fallback',
      templateIdAtSend: null,
    });
  });

  it('テンプレ messageType=carousel → flex に coerce (buildMessage 互換)', async () => {
    const result = await resolveStepContent(
      mockDb({ message_type: 'carousel', message_content: '{"type":"carousel","contents":[]}' }),
      {
        template_id: 'tpl-carousel',
        message_type: 'text',
        message_content: 'fallback',
      },
    );
    expect(result.messageType).toBe('flex');
    expect(result.templateIdAtSend).toBe('tpl-carousel');
  });
});
