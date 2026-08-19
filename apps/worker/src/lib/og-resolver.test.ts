import { describe, it, expect } from 'vitest';
import {
  resolveOgForTrackedLink,
  resolveOgForEvent,
  resolveOgForForm,
  resolveOgForAccount,
} from './og-resolver';

const account = {
  id: 'a1',
  name: 'AAA 表示名',
  og_site_name: 'AAA スクール',
  og_default_image_url: 'https://e.com/default.png',
  og_default_description: 'AAA の説明',
} as any;

describe('resolveOgForTrackedLink', () => {
  it('manual overrides win', () => {
    const link = {
      id: 'l1',
      name: 'auto title',
      og_title: '手動タイトル',
      og_description: '手動説明',
      og_image_url: 'https://e.com/manual.png',
    } as any;
    const og = resolveOgForTrackedLink(link, account, 'https://e.com/t/l1');
    expect(og.title).toBe('手動タイトル');
    expect(og.description).toBe('手動説明');
    expect(og.imageUrl).toBe('https://e.com/manual.png');
    expect(og.siteName).toBe('AAA スクール');
    expect(og.url).toBe('https://e.com/t/l1');
  });

  it('falls back to link.name for title when og_title is null', () => {
    const link = { id: 'l1', name: 'リンク名', og_title: null, og_description: null, og_image_url: null } as any;
    const og = resolveOgForTrackedLink(link, account, 'https://e.com/t/l1');
    expect(og.title).toBe('リンク名');
    expect(og.description).toBe('AAA の説明');
    expect(og.imageUrl).toBe('https://e.com/default.png');
  });

  it('uses account display_name when og_site_name is null', () => {
    const link = { id: 'l1', name: 'n', og_title: null, og_description: null, og_image_url: null } as any;
    const og = resolveOgForTrackedLink(link, { ...account, og_site_name: null }, 'https://e.com/');
    expect(og.siteName).toBe('AAA 表示名');
  });
});

describe('resolveOgForEvent', () => {
  it('maps event columns automatically', () => {
    const event = {
      id: 'e1',
      name: 'イベント名',
      description: 'イベント説明',
      image_url: 'https://e.com/event.jpg',
      og_title: null,
      og_description: null,
      og_image_url: null,
    } as any;
    const og = resolveOgForEvent(event, account, 'https://e.com/events/e1');
    expect(og.title).toBe('イベント名');
    expect(og.description).toBe('イベント説明');
    expect(og.imageUrl).toBe('https://e.com/event.jpg');
  });

  it('event manual overrides win per-field', () => {
    const event = {
      id: 'e1',
      name: 'auto name',
      description: 'auto desc',
      image_url: 'https://e.com/auto.jpg',
      og_title: '手動タイトルのみ',
      og_description: null,
      og_image_url: null,
    } as any;
    const og = resolveOgForEvent(event, account, 'https://e.com/events/e1');
    expect(og.title).toBe('手動タイトルのみ');
    expect(og.description).toBe('auto desc');
    expect(og.imageUrl).toBe('https://e.com/auto.jpg');
  });
});

describe('resolveOgForForm', () => {
  it('maps form columns automatically', () => {
    const form = { id: 'f1', name: 'フォーム名', description: 'フォーム説明' } as any;
    const og = resolveOgForForm(form, account, 'https://e.com/?page=form&id=f1');
    expect(og.title).toBe('フォーム名');
    expect(og.description).toBe('フォーム説明');
    expect(og.imageUrl).toBe('https://e.com/default.png');
    expect(og.siteName).toBe('AAA スクール');
  });

  it('falls back to account default description when form description is empty', () => {
    const form = { id: 'f1', name: 'フォーム名', description: null } as any;
    const og = resolveOgForForm(form, account, 'https://e.com/');
    expect(og.description).toBe('AAA の説明');
  });

  it('form manual overrides win per-field', () => {
    const form = {
      id: 'f1',
      name: 'auto name',
      description: 'auto desc',
      og_title: '手動タイトル',
      og_description: null,
      og_image_url: 'https://e.com/m.png',
    } as any;
    const og = resolveOgForForm(form, account, 'https://e.com/?page=form&id=f1');
    expect(og.title).toBe('手動タイトル');
    expect(og.description).toBe('auto desc');
    expect(og.imageUrl).toBe('https://e.com/m.png');
  });
});

describe('resolveOgForAccount', () => {
  it('builds defaults-only OgParams', () => {
    const og = resolveOgForAccount(account, 'https://e.com/booking');
    expect(og.title).toBe('AAA スクール');
    expect(og.siteName).toBe('AAA スクール');
    expect(og.description).toBe('AAA の説明');
    expect(og.imageUrl).toBe('https://e.com/default.png');
  });

  it('absolutizes relative og:image against request origin', () => {
    const accountWithRelative = { ...account, og_default_image_url: '/images/foo.jpg' };
    const og = resolveOgForAccount(accountWithRelative, 'https://example.workers.dev/booking?x=1');
    expect(og.imageUrl).toBe('https://example.workers.dev/images/foo.jpg');
  });

  it('keeps absolute og:image as-is', () => {
    const og = resolveOgForAccount(account, 'https://example.workers.dev/booking');
    expect(og.imageUrl).toBe('https://e.com/default.png');
  });

  it('falls back to LINE when no account at all', () => {
    const og = resolveOgForAccount(null, 'https://e.com/');
    expect(og.title).toBe('LINE');
    expect(og.siteName).toBe('LINE');
    expect(og.description).toBeUndefined();
    expect(og.imageUrl).toBeUndefined();
  });
});
