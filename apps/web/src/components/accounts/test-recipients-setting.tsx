'use client'

import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'

interface Friend {
  id: string
  displayName: string
  pictureUrl: string | null
}

interface TestRecipientsSettingProps {
  accountId: string
}

export default function TestRecipientsSetting({ accountId }: TestRecipientsSettingProps) {
  const [recipients, setRecipients] = useState<Friend[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<Friend[]>([])
  const [searching, setSearching] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.accountSettings.getTestRecipients(accountId)
      if (res.success) setRecipients(res.data)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [accountId])

  useEffect(() => { load() }, [load])

  // Debounced friend search
  useEffect(() => {
    if (search.length < 2) { setSearchResults([]); return }
    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        // The worker now ranks friends by match quality (exact > prefix >
        // word-start > generic substring) before created_at DESC. So
        // `limit: 10` here gives 10 best matches across the entire account,
        // not "10 newest containing the substring". Fixes the long-standing
        // issue where the operator's own friend record (day-one) was buried
        // by recently-added friends sharing the same substring.
        // includeTags=false: tags not rendered here; skipping the per-row
        // tag fetch turns ~11 D1 reads/keystroke into 2 (count + list).
        const res = await api.friends.list({ search, accountId, limit: 10, includeTags: false })
        if (res.success) {
          const existing = new Set(recipients.map(r => r.id))
          const items = (res.data as unknown as { items: Friend[] }).items ?? res.data
          setSearchResults(
            (Array.isArray(items) ? items : [])
              .filter((f: Friend) => !existing.has(f.id))
              .map((f: Friend) => ({ id: f.id, displayName: f.displayName, pictureUrl: f.pictureUrl }))
          )
        }
      } catch { /* ignore */ }
      finally { setSearching(false) }
    }, 300)
    return () => clearTimeout(timer)
  }, [search, accountId, recipients])

  const addRecipient = async (friend: Friend) => {
    const updated = [...recipients, friend]
    setRecipients(updated)
    setSearch('')
    setSearchResults([])
    setSaving(true)
    try {
      await api.accountSettings.updateTestRecipients(accountId, updated.map(r => r.id))
    } catch { /* ignore */ }
    finally { setSaving(false) }
  }

  const removeRecipient = async (friendId: string) => {
    const updated = recipients.filter(r => r.id !== friendId)
    setRecipients(updated)
    setSaving(true)
    try {
      await api.accountSettings.updateTestRecipients(accountId, updated.map(r => r.id))
    } catch { /* ignore */ }
    finally { setSaving(false) }
  }

  if (loading) return <p className="text-xs text-gray-400">読み込み中...</p>

  return (
    <div className="mt-3 pt-3 border-t border-gray-100">
      <h4 className="text-xs font-semibold text-gray-600 mb-2">テスト送信先</h4>

      {/* Current recipients */}
      {recipients.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {recipients.map(r => (
            <span key={r.id} className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 rounded-full text-xs">
              {r.pictureUrl && <img src={r.pictureUrl} alt="" className="w-4 h-4 rounded-full" />}
              {r.displayName}
              <button onClick={() => removeRecipient(r.id)} className="text-blue-400 hover:text-blue-600 ml-0.5">×</button>
            </span>
          ))}
        </div>
      )}

      {/* Search to add */}
      <div className="relative">
        <input
          type="text"
          placeholder="友だちを検索して追加..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
        {searching && <span className="absolute right-2 top-1.5 text-xs text-gray-400">検索中...</span>}
        {saving && <span className="absolute right-2 top-1.5 text-xs text-green-500">保存中...</span>}

        {searchResults.length > 0 && (
          <ul className="absolute z-10 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
            {searchResults.map(f => (
              <li key={f.id}>
                <button
                  onClick={() => addRecipient(f)}
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 text-left text-xs"
                >
                  {f.pictureUrl ? (
                    <img src={f.pictureUrl} alt="" className="w-5 h-5 rounded-full" />
                  ) : (
                    <div className="w-5 h-5 rounded-full bg-gray-200" />
                  )}
                  {f.displayName}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
