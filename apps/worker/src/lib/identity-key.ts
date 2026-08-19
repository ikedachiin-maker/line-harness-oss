// broadcasts (duplicates-stats.ts) と events (event-booking) で共有する
// 同一人物検知用の SQL fragment。url_token > friends.user_id > friends.id の
// 優先順位で COALESCE する。
//
// 用法: SELECT 内で `(${IDENTITY_KEY_SQL}) AS identity_key` のように差し込む。
//      クエリは friends を JOIN している必要がある (URL_TOKEN_SQL も friends を
//      参照するため)。
import { URL_TOKEN_SQL } from './url-token.js';

export const IDENTITY_KEY_SQL = `
  COALESCE(
    ${URL_TOKEN_SQL},
    'uid:' || friends.user_id,
    'solo:' || friends.id
  )
`;

// SQL fragment と論理的に同等の JS 実装。events の POST/GET で identity_key を
// 計算するために使う。SQL の SUBSTR は 1-indexed なので JS の substring は
// (start-1) からとる。
//
// 引数の friend には id / user_id / picture_url を渡す。
export function computeIdentityKey(friend: {
  id: string;
  user_id: string | null;
  picture_url: string | null;
}): string {
  const pic = friend.picture_url;
  if (pic) {
    if (pic.startsWith('https://sprofile.line-scdn.net/')) {
      // SUBSTR(picture_url, 42, 80) → JS substring(41, 121)
      const token = pic.substring(41, 121);
      if (token) return token;
    } else if (pic.startsWith('https://profile.line-scdn.net/')) {
      // SUBSTR(picture_url, 41, 80) → JS substring(40, 120)
      const token = pic.substring(40, 120);
      if (token) return token;
    }
  }
  if (friend.user_id) return `uid:${friend.user_id}`;
  return `solo:${friend.id}`;
}
