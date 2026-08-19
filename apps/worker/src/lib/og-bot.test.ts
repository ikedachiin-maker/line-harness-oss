import { describe, it, expect } from 'vitest';
import { isLinkPreviewBot } from './og-bot';

describe('isLinkPreviewBot', () => {
  it('detects LINE link preview crawler', () => {
    expect(isLinkPreviewBot('LINEdc/1.0')).toBe(true);
    expect(isLinkPreviewBot('Linedc/2.0 (compatible)')).toBe(true);
  });

  it('detects Twitter/X bot', () => {
    expect(isLinkPreviewBot('Twitterbot/1.0')).toBe(true);
  });

  it('detects Facebook external hit and Meta external agent', () => {
    expect(isLinkPreviewBot('facebookexternalhit/1.1')).toBe(true);
    expect(isLinkPreviewBot('meta-externalagent/1.1')).toBe(true);
  });

  it('detects Discord, Slack, Telegram, LinkedIn', () => {
    expect(isLinkPreviewBot('Mozilla/5.0 (compatible; Discordbot/2.0)')).toBe(true);
    expect(isLinkPreviewBot('Slackbot-LinkExpanding 1.0')).toBe(true);
    expect(isLinkPreviewBot('TelegramBot (like TwitterBot)')).toBe(true);
    expect(isLinkPreviewBot('LinkedInBot/1.0')).toBe(true);
  });

  it('does NOT classify WhatsApp UA as bot (real users share the same UA)', () => {
    expect(isLinkPreviewBot('WhatsApp/2.24.0.0')).toBe(false);
  });

  it('does NOT detect LINE in-app browser without preview crawler suffix', () => {
    expect(isLinkPreviewBot('Mozilla/5.0 (Linux; Android 11; Line/12.0.0)')).toBe(false);
  });

  it('does NOT detect regular browsers', () => {
    expect(isLinkPreviewBot('Mozilla/5.0 (Macintosh; Intel Mac OS X)')).toBe(false);
    expect(isLinkPreviewBot('')).toBe(false);
  });

  it('handles undefined/null safely', () => {
    expect(isLinkPreviewBot(undefined as unknown as string)).toBe(false);
    expect(isLinkPreviewBot(null as unknown as string)).toBe(false);
  });
});
