'use client'

interface AccountOption {
  id: string
  name: string
}

interface Props {
  q: string
  onlyDups: boolean
  account: string
  accountOptions: AccountOption[]
  onChange: (next: { q?: string; onlyDups?: boolean; account?: string }) => void
}

export default function UsersFilters({
  q,
  onlyDups,
  account,
  accountOptions,
  onChange,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg bg-white p-4 shadow-sm ring-1 ring-gray-200">
      <input
        type="search"
        value={q}
        onChange={(e) => onChange({ q: e.target.value })}
        placeholder="名前・X・メール・電話・LINE ID で検索"
        className="min-w-[240px] flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
      />
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={onlyDups}
          onChange={(e) => onChange({ onlyDups: e.target.checked })}
        />
        重複のみ
      </label>
      <select
        value={account}
        onChange={(e) => onChange({ account: e.target.value })}
        className="rounded-md border border-gray-300 px-3 py-2 text-sm"
      >
        <option value="">全アカウント</option>
        {accountOptions.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </div>
  )
}
