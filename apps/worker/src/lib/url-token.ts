/**
 * SQL fragment that extracts the per-user portion of a LINE profile picture
 * URL — the middle 80 chars after the CDN host prefix. Same value across
 * channels for the same human, so this is the only signal that bridges
 * provider-disjoint user_id namespaces (e.g. L Harness ↔ X Harness).
 *
 * Returns NULL when picture_url is absent or hosted on an unrecognized CDN.
 *
 * Intended use: substitute into a SELECT clause as `(${URL_TOKEN_SQL}) AS url_token`.
 */
export const URL_TOKEN_SQL = `
  CASE
    WHEN picture_url LIKE 'https://sprofile.line-scdn.net/%' THEN SUBSTR(picture_url, 42, 80)
    WHEN picture_url LIKE 'https://profile.line-scdn.net/%' THEN SUBSTR(picture_url, 41, 80)
    ELSE NULL
  END
`;
