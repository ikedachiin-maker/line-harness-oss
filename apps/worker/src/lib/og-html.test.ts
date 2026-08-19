import { describe, it, expect } from 'vitest';
import { buildOgHtml } from './og-html';

describe('buildOgHtml', () => {
  it('builds minimum required tags', () => {
    const html = buildOgHtml({
      title: 'テストイベント',
      siteName: 'AAA スクール',
      url: 'https://example.com/events/abc',
    });
    expect(html).toContain('<title>テストイベント</title>');
    expect(html).toContain('<meta property="og:title" content="テストイベント">');
    expect(html).toContain('<meta property="og:site_name" content="AAA スクール">');
    expect(html).toContain('<meta property="og:url" content="https://example.com/events/abc">');
    expect(html).toContain('<meta property="og:type" content="website">');
  });

  it('includes description when provided', () => {
    const html = buildOgHtml({
      title: 't',
      siteName: 's',
      url: 'https://e.com/',
      description: '説明文',
    });
    expect(html).toContain('<meta property="og:description" content="説明文">');
    expect(html).toContain('<meta name="description" content="説明文">');
  });

  it('omits description meta when not provided', () => {
    const html = buildOgHtml({ title: 't', siteName: 's', url: 'https://e.com/' });
    expect(html).not.toContain('og:description');
    expect(html).not.toContain('name="description"');
  });

  it('uses summary_large_image when image provided, summary otherwise', () => {
    const withImg = buildOgHtml({
      title: 't',
      siteName: 's',
      url: 'https://e.com/',
      imageUrl: 'https://e.com/img.jpg',
    });
    expect(withImg).toContain('<meta property="og:image" content="https://e.com/img.jpg">');
    expect(withImg).toContain('<meta name="twitter:card" content="summary_large_image">');

    const noImg = buildOgHtml({ title: 't', siteName: 's', url: 'https://e.com/' });
    expect(noImg).not.toContain('og:image');
    expect(noImg).toContain('<meta name="twitter:card" content="summary">');
  });

  it('HTML-escapes special characters', () => {
    const html = buildOgHtml({
      title: '<script>alert("xss")</script>',
      siteName: 'A & B',
      url: 'https://e.com/?q=1&r=2',
      description: `"quoted" & 'single'`,
    });
    expect(html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    expect(html).toContain('A &amp; B');
    expect(html).toContain('https://e.com/?q=1&amp;r=2');
    expect(html).toContain('&quot;quoted&quot; &amp; &#39;single&#39;');
    expect(html).not.toContain('<script>alert');
  });

  it('truncates title to 80 chars and description to 200 chars', () => {
    const longTitle = 'あ'.repeat(100);
    const longDesc = 'い'.repeat(300);
    const html = buildOgHtml({
      title: longTitle,
      siteName: 's',
      url: 'https://e.com/',
      description: longDesc,
    });
    const titleMatch = html.match(/og:title" content="([^"]+)"/);
    expect(titleMatch![1].length).toBeLessThanOrEqual(80);
    const descMatch = html.match(/og:description" content="([^"]+)"/);
    expect(descMatch![1].length).toBeLessThanOrEqual(200);
  });

  it('treats empty string fields as missing', () => {
    const html = buildOgHtml({
      title: 't',
      siteName: 's',
      url: 'https://e.com/',
      description: '',
      imageUrl: '',
    });
    expect(html).not.toContain('og:description');
    expect(html).not.toContain('og:image');
  });
});
