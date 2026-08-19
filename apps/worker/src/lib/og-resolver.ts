import type { OgParams } from './og-html';

type LineAccountRow = {
  id: string;
  name: string | null;
  og_site_name: string | null;
  og_default_image_url: string | null;
  og_default_description: string | null;
};

type TrackedLinkRow = {
  id: string;
  name: string;
  og_title: string | null;
  og_description: string | null;
  og_image_url: string | null;
};

type EventRow = {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  og_title: string | null;
  og_description: string | null;
  og_image_url: string | null;
};

type FormRow = {
  id: string;
  name: string;
  description: string | null;
  og_title: string | null;
  og_description: string | null;
  og_image_url: string | null;
};

function siteNameOf(account: LineAccountRow | null): string {
  return account?.og_site_name?.trim() || account?.name?.trim() || 'LINE';
}

function nonEmpty(s: string | null | undefined): string | undefined {
  return s && s.trim() ? s : undefined;
}

// 相対パス（`/images/foo.jpg`）や protocol-relative（`//cdn/foo.jpg`）の
// og:image を request origin に対する絶対 URL に解決する。クローラは相対
// URL の og:image を無視するため必須。
function absolutizeImageUrl(
  imageUrl: string | undefined,
  pageUrl: string,
): string | undefined {
  if (!imageUrl) return undefined;
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
  try {
    return new URL(imageUrl, pageUrl).toString();
  } catch {
    return imageUrl;
  }
}

export function resolveOgForTrackedLink(
  link: TrackedLinkRow,
  account: LineAccountRow | null,
  url: string,
): OgParams {
  return {
    title: nonEmpty(link.og_title) ?? nonEmpty(link.name) ?? siteNameOf(account),
    description: nonEmpty(link.og_description) ?? nonEmpty(account?.og_default_description),
    imageUrl: absolutizeImageUrl(
      nonEmpty(link.og_image_url) ?? nonEmpty(account?.og_default_image_url),
      url,
    ),
    siteName: siteNameOf(account),
    url,
  };
}

export function resolveOgForEvent(
  event: EventRow,
  account: LineAccountRow | null,
  url: string,
): OgParams {
  return {
    title: nonEmpty(event.og_title) ?? nonEmpty(event.name) ?? siteNameOf(account),
    description:
      nonEmpty(event.og_description) ??
      nonEmpty(event.description) ??
      nonEmpty(account?.og_default_description),
    imageUrl: absolutizeImageUrl(
      nonEmpty(event.og_image_url) ??
        nonEmpty(event.image_url) ??
        nonEmpty(account?.og_default_image_url),
      url,
    ),
    siteName: siteNameOf(account),
    url,
  };
}

export function resolveOgForForm(
  form: FormRow,
  account: LineAccountRow | null,
  url: string,
): OgParams {
  return {
    title: nonEmpty(form.og_title) ?? nonEmpty(form.name) ?? siteNameOf(account),
    description:
      nonEmpty(form.og_description) ??
      nonEmpty(form.description) ??
      nonEmpty(account?.og_default_description),
    imageUrl: absolutizeImageUrl(
      nonEmpty(form.og_image_url) ?? nonEmpty(account?.og_default_image_url),
      url,
    ),
    siteName: siteNameOf(account),
    url,
  };
}

export function resolveOgForAccount(account: LineAccountRow | null, url: string): OgParams {
  const siteName = siteNameOf(account);
  return {
    title: siteName,
    description: nonEmpty(account?.og_default_description),
    imageUrl: absolutizeImageUrl(nonEmpty(account?.og_default_image_url), url),
    siteName,
    url,
  };
}
