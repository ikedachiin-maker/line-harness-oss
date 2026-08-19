'use client'

import InboxRow, { type InboxRowData } from './inbox-row'

const fmt = new Intl.NumberFormat('ja-JP')

interface Props {
  rows: InboxRowData[]
  total: number
  page: number
  pageSize: number
  loading: boolean
  onPageChange: (page: number) => void
}

export default function InboxList({
  rows,
  total,
  page,
  pageSize,
  loading,
  onPageChange,
}: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1
  const end = Math.min(total, page * pageSize)

  return (
    <div className="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-gray-200">
      {rows.length === 0 && !loading ? (
        <div className="px-4 py-12 text-center text-sm text-gray-400">
          未対応はありません 🎉
        </div>
      ) : (
        <div>
          {rows.map((row) => (
            <InboxRow key={row.friendId} row={row} />
          ))}
        </div>
      )}
      {total > 0 && (
        <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3 text-sm text-gray-600">
          <span>
            {fmt.format(total)} 件中 {fmt.format(start)}–{fmt.format(end)} 件
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1 || loading}
              className="rounded-md border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              前へ
            </button>
            <span className="tabular-nums text-xs text-gray-500">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages || loading}
              className="rounded-md border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              次へ
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
