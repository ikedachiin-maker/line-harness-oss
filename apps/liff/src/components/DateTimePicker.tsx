import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { jstToday, addDays, formatJp } from '../lib/datetime.js';

export default function DateTimePicker({
  menuId,
  staffId,
  ctaLabel,
  onSelect,
  onBack,
}: {
  menuId: string;
  staffId: string;
  ctaLabel: string;
  onSelect: (s: { date: string; start: string }) => void;
  onBack: () => void;
}) {
  const [from] = useState(jstToday());
  const [to] = useState(addDays(jstToday(), 13));
  const [byDate, setByDate] = useState<Record<string, string[]> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .availability(menuId, staffId, from, to)
      .then((r) => {
        const slots = r.by_staff[0]?.slots ?? [];
        const grouped: Record<string, string[]> = {};
        for (const s of slots) (grouped[s.date] ??= []).push(s.start);
        setByDate(grouped);
      })
      .catch((e) => setError(String(e)));
  }, [menuId, staffId, from, to]);

  if (error) return <p className="text-red-600">{error}</p>;
  if (!byDate) return <div className="text-gray-500">空き枠を取得中...</div>;

  const dates = Object.keys(byDate);
  return (
    <div className="space-y-3">
      <button onClick={onBack} className="text-sm text-gray-500">← 戻る</button>
      <h1 className="text-xl font-bold">日時を選んでください</h1>
      <p className="text-xs text-gray-500">{ctaLabel}</p>
      {dates.length === 0 ? (
        <p className="text-gray-500 mt-4">この期間に空きはありません。</p>
      ) : (
        <div className="space-y-4">
          {dates.map((date) => (
            <section key={date}>
              <h2 className="font-semibold mb-2">{formatJp(date)}</h2>
              <div className="grid grid-cols-4 gap-2">
                {byDate[date].map((t) => (
                  <button
                    key={t}
                    onClick={() => onSelect({ date, start: t })}
                    className="border rounded py-2 text-sm hover:bg-gray-50 active:bg-gray-100"
                  >
                    {t}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
