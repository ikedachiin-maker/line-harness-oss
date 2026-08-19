'use client'

import UserRow, { type UserRowData } from './user-row'

const fmt = new Intl.NumberFormat('ja-JP')

const ACCOUNT_BADGE_COLORS = [
  'bg-emerald-100 text-emerald-700',
  'bg-sky-100 text-sky-700',
  'bg-violet-100 text-violet-700',
  'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700',
  'bg-slate-100 text-slate-700',
]

interface Props {
  rows: UserRowData[]
  total: number
  page: number
  pageSize: number
  loading: boolean
  onPageChange: (page: number) => void
}

export default function UsersTable({
  rows,
  total,
  page,
  pageSize,
  loading,
  onPageChange,
}: Props) {
  const accountColorMap = new Map<string, string>()
  for (const row of rows) {
    for (const a of row.accounts) {
      if (!accountColorMap.has(a.accountId)) {
        accountColorMap.set(
          a.accountId,
          ACCOUNT_BADGE_COLORS[accountColorMap.size % ACCOUNT_BADGE_COLORS.length],
        )
      }
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1
  const end = Math.min(total, page * pageSize)

  return (
    <div className="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-gray-200">
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead className="bg-gray-50 text-left text-xs font-medium uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">識別子</th>
              <th className="px-4 py-3">表示名</th>
              <th className="px-4 py-3">登録アカウント</th>
              <th className="px-4 py-3">X</th>
              <th className="px-4 py-3">メール</th>
              <th className="px-4 py-3">電話</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">
                  該当ユーザーがいません
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <UserRow key={row.identityKey} row={row} accountColorMap={accountColorMap} />
              ))
            )}
          </tbody>
        </table>
      </div>
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
    </div>
  )
}
