'use client'

import { useState } from 'react'
import { api } from '@/lib/api'
import { COUNTRY_OPTIONS, countryFlag } from '@/lib/country-flag'

interface Props {
  accountId: string
  initialCountry: string | null
  initialRole: string | null
  onUpdated: () => void
}

export default function AccountSettingsSection({
  accountId, initialCountry, initialRole, onUpdated,
}: Props) {
  const isPredefined = initialCountry === null
    || (COUNTRY_OPTIONS as readonly string[]).slice(0, -1).includes(initialCountry)
  const [select, setSelect] = useState<string>(
    initialCountry === null
      ? ''
      : isPredefined ? initialCountry : 'その他',
  )
  const [other, setOther] = useState<string>(
    isPredefined ? '' : (initialCountry ?? ''),
  )
  const [role, setRole] = useState<string>(initialRole ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const computedCountry = (): string | null => {
    if (select === '') return null
    if (select === 'その他') {
      const t = other.trim()
      return t === '' ? null : t
    }
    return select
  }

  const handleSave = async () => {
    setSaving(true); setError('')
    try {
      const res = await api.lineAccounts.update(accountId, {
        country: computedCountry(),
        role: role.trim() === '' ? null : role.trim(),
      })
      if (res.success) onUpdated()
      else setError(res.error || '保存に失敗しました')
    } catch {
      setError('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3 mt-3 pt-3 border-t border-gray-100">
      <p className="text-xs font-medium text-gray-600">アカウント設定</p>

      <div>
        <label className="block text-xs text-gray-500 mb-1">国/地域</label>
        <div className="flex gap-2 items-center">
          <select
            value={select}
            onChange={(e) => setSelect(e.target.value)}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm flex-1"
          >
            <option value="">未設定</option>
            {COUNTRY_OPTIONS.map((c) => (
              <option key={c} value={c}>{c} {countryFlag(c)}</option>
            ))}
          </select>
          {select === 'その他' && (
            <input
              type="text"
              value={other}
              onChange={(e) => setOther(e.target.value)}
              placeholder="例: インドネシア"
              className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm flex-1"
            />
          )}
          {countryFlag(computedCountry()) && (
            <span className="text-base">{countryFlag(computedCountry())}</span>
          )}
        </div>
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">役割</label>
        <input
          type="text"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          placeholder="本店 / プロモ / 実験 など"
          className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
        />
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <button
        onClick={handleSave}
        disabled={saving}
        className="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-xs font-medium disabled:opacity-50"
      >
        {saving ? '保存中...' : '保存'}
      </button>
    </div>
  )
}
