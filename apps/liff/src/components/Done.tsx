import { Link, useLocation } from 'react-router-dom';

export default function Done() {
  // initLiff() は ?liffId=... をクエリから読むので、内部遷移でも保持する。
  // search を維持しないと「予約履歴を見る」→ WebView 再読み込みで liffId が失われる。
  const { search } = useLocation();
  return (
    <div className="space-y-4 text-center pt-12">
      <h1 className="text-2xl font-bold">リクエストを送信しました</h1>
      <p className="text-gray-600">
        お店からの返信をお待ちください。
        <br />
        確定すると LINE に通知が届きます。
      </p>
      <Link to={{ pathname: '/booking/history', search }} className="inline-block underline text-blue-600">
        予約履歴を見る
      </Link>
    </div>
  );
}
