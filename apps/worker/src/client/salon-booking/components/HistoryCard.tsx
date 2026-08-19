import type { BookingHistoryItem } from '../lib/api.js';
import { utcToJstDisplay } from '../lib/datetime.js';

const STATUS_LABEL: Record<string, { label: string; bg: string; fg: string }> = {
  requested: { label: 'リクエスト中', bg: '#fef3c7', fg: '#92400e' },
  confirmed: { label: '確定', bg: '#d1fae5', fg: '#065f46' },
  rejected: { label: '不可', bg: '#f3f4f6', fg: '#6b7280' },
  expired: { label: '期限切れ', bg: '#f3f4f6', fg: '#6b7280' },
  cancelled: { label: 'キャンセル', bg: '#f3f4f6', fg: '#6b7280' },
  completed: { label: '完了', bg: '#dbeafe', fg: '#1e40af' },
  no_show: { label: '無断', bg: '#fee2e2', fg: '#991b1b' },
};

export default function HistoryCard({ booking }: { booking: BookingHistoryItem }) {
  const meta = STATUS_LABEL[booking.status] ?? { label: booking.status, bg: '#f3f4f6', fg: '#6b7280' };
  return (
    <li className="sb-card flex gap-3 items-start">
      {booking.profile_image_url ? (
        <img
          src={booking.profile_image_url}
          alt={booking.staff_name}
          className="w-11 h-11 rounded-full object-cover shrink-0"
        />
      ) : (
        <div className="w-11 h-11 rounded-full bg-gray-200 shrink-0 flex items-center justify-center text-gray-400 text-sm">
          {booking.staff_name.slice(0, 1)}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-gray-900 truncate">{booking.menu_name}</div>
        <div className="text-xs text-gray-500 mt-0.5">{booking.staff_name}</div>
        <div className="text-xs text-gray-600 mt-1 tabular-nums">{utcToJstDisplay(booking.starts_at)}</div>
      </div>
      <span className="sb-badge shrink-0" style={{ background: meta.bg, color: meta.fg }}>
        {meta.label}
      </span>
    </li>
  );
}
