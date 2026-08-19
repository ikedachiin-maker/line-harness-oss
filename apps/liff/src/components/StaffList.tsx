import { useEffect, useState } from 'react';
import { api, type StaffItem } from '../lib/api.js';

export default function StaffList({
  menuId,
  basePrice,
  onSelect,
  onBack,
}: {
  menuId: string;
  basePrice: number;
  onSelect: (s: StaffItem) => void;
  onBack: () => void;
}) {
  const [list, setList] = useState<StaffItem[] | null>(null);

  useEffect(() => {
    api.staffOf(menuId).then((r) => setList(r.staff));
  }, [menuId]);

  if (!list) return <div className="text-gray-500">読み込み中...</div>;
  if (list.length === 0) {
    return (
      <div className="space-y-3">
        <button onClick={onBack} className="text-sm text-gray-500">← 戻る</button>
        <p className="text-gray-500">このメニューを担当できるスタッフがいません。</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <button onClick={onBack} className="text-sm text-gray-500">← 戻る</button>
      <h1 className="text-xl font-bold">担当を選んでください</h1>
      <ul className="space-y-2">
        {list.map((s) => (
          <li key={s.id}>
            <button
              onClick={() => onSelect(s)}
              className="w-full flex items-center gap-3 p-3 border rounded-lg hover:bg-gray-50"
            >
              {s.profile_image_url ? (
                <img
                  src={s.profile_image_url}
                  alt={s.display_name}
                  className="w-12 h-12 rounded-full object-cover"
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-gray-200" />
              )}
              <div className="text-left flex-1">
                <div className="font-medium">{s.display_name}</div>
                {s.role && <div className="text-sm text-gray-500">{s.role}</div>}
                {s.price !== basePrice && (
                  <div className="text-xs text-gray-500">¥{s.price.toLocaleString()}〜</div>
                )}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
