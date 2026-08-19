import { useEffect, useState } from 'react';
import { api, type MenuItem } from '../lib/api.js';

export default function MenuList({ onSelect }: { onSelect: (m: MenuItem) => void }) {
  const [menus, setMenus] = useState<MenuItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.menus().then((r) => setMenus(r.menus)).catch((e) => setError(String(e)));
  }, []);

  if (error) return <p className="text-red-600">{error}</p>;
  if (!menus) return <div className="text-gray-500">読み込み中...</div>;

  const grouped = new Map<string, MenuItem[]>();
  for (const m of menus) {
    const key = m.category_label ?? 'その他';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(m);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">メニューを選んでください</h1>
      {[...grouped.entries()].map(([cat, items]) => (
        <section key={cat}>
          <h2 className="font-semibold text-gray-700 mb-2">{cat}</h2>
          <ul className="space-y-2">
            {items.map((m) => (
              <li key={m.id}>
                <button
                  onClick={() => onSelect(m)}
                  className="w-full text-left p-3 border rounded-lg hover:bg-gray-50 active:bg-gray-100"
                >
                  <div className="font-medium">{m.name}</div>
                  {m.description && <div className="text-sm text-gray-500 mt-1">{m.description}</div>}
                  <div className="text-sm text-gray-500 mt-1">
                    {m.duration_minutes} 分 / ¥{m.base_price.toLocaleString()}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
