// 週カレンダー: 横軸に7日、縦軸に時間軸（30分刻み）。
// availability で受け取った {date → [HH:MM, ...]} を grid セルにマップして
// タップ可能なものは緑、空いてないものは灰色で示す。

import { useMemo } from 'react';
import { addDays, formatJp } from '../lib/datetime.js';

export interface WeekCalendarProps {
  byDate: Record<string, string[]>; // 'YYYY-MM-DD' → ['10:00', '10:30', ...]
  weekStart: string;                  // 表示開始日 (YYYY-MM-DD JST)
  onPick: (slot: { date: string; start: string }) => void;
  selectedDate?: string;
  selectedStart?: string;
}

// HH:MM ↔ 分数の変換
function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
function fromMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const SLOT_MIN = 30;

export default function WeekCalendar({
  byDate,
  weekStart,
  onPick,
  selectedDate,
  selectedStart,
}: WeekCalendarProps) {
  const dates = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  const { rows, hasAny } = useMemo(() => {
    const set = new Set<number>();
    for (const d of dates) for (const t of byDate[d] ?? []) set.add(toMin(t));
    if (set.size === 0) return { rows: [] as string[], hasAny: false };
    const min = Math.min(...set);
    const max = Math.max(...set);
    const arr: string[] = [];
    for (let m = min; m <= max; m += SLOT_MIN) arr.push(fromMin(m));
    return { rows: arr, hasAny: true };
  }, [byDate, dates]);

  if (!hasAny) {
    return (
      <div className="sb-card text-center text-sm text-gray-500 py-8">
        この週に空きはありません
      </div>
    );
  }

  const todayJst = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

  return (
    <div
      className="bg-white rounded-2xl overflow-hidden"
      style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)', padding: 4 }}
    >
      <div
        className="grid text-center"
        style={{
          gridTemplateColumns: `40px repeat(7, minmax(0, 1fr))`,
          gap: 0,
        }}
      >
        {/* ヘッダー行: 空白セル + 7 日付 */}
        <div className="bg-gray-50 border-b border-gray-200" />
        {dates.map((d) => {
          const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
          const isToday = d === todayJst;
          const tone = dow === 0 ? '#ef4444' : dow === 6 ? '#3b82f6' : '#374151';
          return (
            <div
              key={d}
              className="bg-gray-50 border-b border-gray-200 py-2 px-1"
              style={{ color: tone }}
            >
              <div className="text-[10px] leading-none font-medium">
                {'日月火水木金土'[dow]}
              </div>
              <div
                className="text-sm font-bold mt-1 leading-none"
                style={
                  isToday
                    ? {
                        color: '#fff',
                        background: '#06C755',
                        borderRadius: 9999,
                        width: 22,
                        height: 22,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }
                    : undefined
                }
              >
                {Number(d.slice(8))}
              </div>
            </div>
          );
        })}

        {/* 時間行 */}
        {rows.map((t) => {
          const isHourMark = t.endsWith(':00');
          return (
            <div key={`row-${t}`} style={{ display: 'contents' }}>
              {/* 時間ラベル: 毎時 (HH:00) のみ表示 */}
              <div
                className="border-r border-gray-100 text-[10px] text-gray-400 tabular-nums flex items-start justify-center pt-0.5"
                style={{
                  height: 36,
                  borderTop: isHourMark ? '1px solid #e5e7eb' : '1px dashed #f3f4f6',
                }}
              >
                {isHourMark ? t : ''}
              </div>
              {dates.map((d) => {
                const slots = byDate[d] ?? [];
                const available = slots.includes(t);
                const isSelected =
                  available && selectedDate === d && selectedStart === t;
                return (
                  <div
                    key={`${d}-${t}`}
                    className="border-r border-gray-100"
                    style={{
                      height: 36,
                      borderTop: isHourMark ? '1px solid #e5e7eb' : '1px dashed #f3f4f6',
                      padding: 1,
                    }}
                  >
                    {available ? (
                      <button
                        onClick={() => onPick({ date: d, start: t })}
                        className="rounded-md transition-transform active:scale-90 tabular-nums"
                        style={{
                          width: '100%',
                          height: '100%',
                          background: isSelected ? '#06C755' : '#ecfdf5',
                          border: isSelected ? '1.5px solid #06C755' : '1px solid #86efac',
                          color: isSelected ? '#fff' : '#047857',
                          fontSize: 11,
                          fontWeight: 700,
                          lineHeight: 1,
                        }}
                        aria-label={`${formatJp(d)} ${t}`}
                      >
                        {/* セル内に時刻を表示。:30 開始の空き枠でも何時か即判別できる。
                            選択中はチェックマークに切替して視認性 ↑ */}
                        {isSelected ? '✓' : t}
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
