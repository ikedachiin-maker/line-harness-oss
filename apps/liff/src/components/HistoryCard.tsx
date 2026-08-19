import type { BookingHistoryItem } from '../lib/api.js';
import { utcToJstDisplay } from '../lib/datetime.js';

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  requested: { label: 'リクエスト中', color: 'bg-yellow-100 text-yellow-800' },
  confirmed: { label: '確定', color: 'bg-green-100 text-green-800' },
  rejected: { label: '不可', color: 'bg-gray-100 text-gray-600' },
  expired: { label: '期限切れ', color: 'bg-gray-100 text-gray-600' },
  cancelled: { label: 'キャンセル', color: 'bg-gray-100 text-gray-600' },
  completed: { label: '完了', color: 'bg-blue-100 text-blue-800' },
  no_show: { label: '無断キャンセル', color: 'bg-red-100 text-red-800' },
};

export default function HistoryCard({ booking }: { booking: BookingHistoryItem }) {
  const meta = STATUS_LABEL[booking.status] ?? { label: booking.status, color: 'bg-gray-100' };
  return (
    <li className="border rounded p-3 flex gap-3 items-start">
      {booking.profile_image_url ? (
        <img
          src={booking.profile_image_url}
          alt={booking.staff_name}
          className="w-12 h-12 rounded-full object-cover"
        />
      ) : (
        <div className="w-12 h-12 rounded-full bg-gray-200" />
      )}
      <div className="flex-1">
        <div className="font-medium">{booking.menu_name}</div>
        <div className="text-sm text-gray-600">{booking.staff_name}</div>
        <div className="text-sm text-gray-600">{utcToJstDisplay(booking.starts_at)}</div>
      </div>
      <span className={`text-xs px-2 py-1 rounded h-fit ${meta.color}`}>{meta.label}</span>
    </li>
  );
}
