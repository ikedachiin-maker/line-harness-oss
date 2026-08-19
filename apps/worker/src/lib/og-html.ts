export interface OgParams {
  title: string;
  description?: string;
  imageUrl?: string;
  siteName: string;
  url: string;
  type?: 'website' | 'article';
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

export function buildOgHtml(params: OgParams): string {
  const title = escapeHtml(truncate(params.title, 80));
  const siteName = escapeHtml(params.siteName);
  const url = escapeHtml(params.url);
  const type = params.type ?? 'website';

  const description = params.description?.trim()
    ? escapeHtml(truncate(params.description.trim(), 200))
    : null;
  const imageUrl = params.imageUrl?.trim() ? escapeHtml(params.imageUrl.trim()) : null;

  const descLines = description
    ? [
        `<meta property="og:description" content="${description}">`,
        `<meta name="description" content="${description}">`,
      ]
    : [];
  const imgLines = imageUrl
    ? [
        `<meta property="og:image" content="${imageUrl}">`,
        `<meta name="twitter:card" content="summary_large_image">`,
      ]
    : [`<meta name="twitter:card" content="summary">`];

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>${title}</title>
<meta property="og:title" content="${title}">
<meta property="og:site_name" content="${siteName}">
<meta property="og:url" content="${url}">
<meta property="og:type" content="${type}">
${descLines.join('\n')}
${imgLines.join('\n')}
</head>
<body><p>${title}</p></body>
</html>`;
}
