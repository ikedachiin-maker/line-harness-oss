/**
 * Map free-text country names to flag emojis. Used in the sidebar account
 * switcher and the broadcast preview to give the operator a visual cue
 * about which channels are which country.
 *
 * Coverage rule: include the JP names (canonical for our operator), the
 * EN names (likely from new operators), and lowercase fallbacks. If the
 * input doesn't match anything, return '' so the UI silently degrades.
 *
 * Adding a country: add a JP key, an EN key, and the EN-lowercase key.
 */
const FLAG_MAP: Record<string, string> = {
  // Japanese names
  '日本': '🇯🇵', 'タイ': '🇹🇭', '台湾': '🇹🇼',
  '中国': '🇨🇳', '韓国': '🇰🇷', 'アメリカ': '🇺🇸',
  '英国': '🇬🇧', 'シンガポール': '🇸🇬',
  'インドネシア': '🇮🇩', 'ベトナム': '🇻🇳',
  'マレーシア': '🇲🇾', 'インド': '🇮🇳',

  // English names
  'Japan': '🇯🇵', 'Thailand': '🇹🇭', 'Taiwan': '🇹🇼',
  'China': '🇨🇳', 'Korea': '🇰🇷', 'USA': '🇺🇸',
  'UK': '🇬🇧', 'Singapore': '🇸🇬',
  'Indonesia': '🇮🇩', 'Vietnam': '🇻🇳',
  'Malaysia': '🇲🇾', 'India': '🇮🇳',

  // Lowercase fallback (covers 'japan', 'thailand', etc.)
  'japan': '🇯🇵', 'thailand': '🇹🇭', 'taiwan': '🇹🇼',
  'china': '🇨🇳', 'korea': '🇰🇷', 'usa': '🇺🇸',
  'uk': '🇬🇧', 'singapore': '🇸🇬',
  'indonesia': '🇮🇩', 'vietnam': '🇻🇳',
  'malaysia': '🇲🇾', 'india': '🇮🇳',
};

export const COUNTRY_OPTIONS = ['日本', 'タイ', '台湾', '中国', '韓国', 'アメリカ', 'その他'] as const;

export const countryFlag = (name: string | null | undefined): string => {
  if (!name) return '';
  const trimmed = name.trim();
  return FLAG_MAP[trimmed] ?? FLAG_MAP[trimmed.toLowerCase()] ?? '';
};
