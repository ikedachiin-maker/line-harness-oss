import { useState } from 'react';
import { api, type MenuItem, type StaffItem } from '../lib/api.js';
import { jstStartsAtIso } from '../lib/datetime.js';

export default function Confirm({
  menu,
  staff,
  slot,
  onSubmitted,
  onBack,
}: {
  menu: MenuItem;
  staff: StaffItem;
  slot: { date: string; start: string };
  onSubmitted: () => void;
  onBack: () => void;
}) {
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idemKey] = useState(() => crypto.randomUUID());

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      await api.createRequest(
        {
          menu_id: menu.id,
          staff_id: staff.id,
          starts_at: jstStartsAtIso(slot.date, slot.start),
          customer_note: note || undefined,
        },
        idemKey,
      );
      onSubmitted();
    } catch (e) {
      const err = e as { status?: number; body?: { error?: string } };
      if (err.status === 409 && err.body?.error === 'slot_conflict') {
        setError('この時間枠は他の方の予約と重なりました。日時を選び直してください。');
      } else {
        setError('予約リクエストの送信に失敗しました。時間をおいて再度お試しください。');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-sm text-gray-500">← 戻る</button>
      <h1 className="text-xl font-bold">内容のご確認</h1>
      <dl className="space-y-2 border rounded p-4 text-sm">
        <Row label="メニュー" value={menu.name} />
        <Row label="担当" value={staff.display_name} />
        <Row label="日時" value={`${slot.date} ${slot.start}`} />
        <Row label="所要" value={`${staff.duration_minutes} 分`} />
        <Row label="料金（目安）" value={`¥${staff.price.toLocaleString()}`} />
      </dl>
      <label className="block">
        <span className="text-sm text-gray-700">ご要望（任意）</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="mt-1 w-full border rounded p-2 text-sm"
          rows={3}
          placeholder="髪型の希望、アレルギー、その他"
        />
      </label>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <button
        onClick={handleSubmit}
        disabled={submitting}
        className="w-full bg-green-600 text-white py-3 rounded font-semibold disabled:opacity-50"
      >
        {submitting ? '送信中...' : '予約をリクエスト'}
      </button>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-gray-600">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
