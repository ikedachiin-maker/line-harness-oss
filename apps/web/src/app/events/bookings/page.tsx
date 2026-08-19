'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'
import { eventsApi, type EventBookingItem, type EventDetail } from '@/lib/api'

const STATUS_TABS: Array<{ key: string; label: string }> = [
  { key: 'requested', label: '承認待ち' },
  { key: 'confirmed', label: '確定' },
  { key: 'rejected', label: '拒否' },
  { key: 'cancelled', label: 'キャンセル' },
  { key: 'expired', label: '期限切れ' },
  { key: 'attended', label: '参加済' },
  { key: 'no_show', label: '無断' },
  { key: 'all', label: '全件' },
]

const statusBadge: Record<string, string> = {
  requested: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-green-100 text-green-800',
  rejected: 'bg-gray-100 text-gray-700',
  cancelled: 'bg-gray-100 text-gray-600',
  expired: 'bg-gray-100 text-gray-500',
  attended: 'bg-blue-100 text-blue-800',
  no_show: 'bg-red-100 text-red-800',
}

function formatJp(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function BookingsInner() {
  const params = useSearchParams()
  const eventId = params.get('id')
  const { selectedAccountId, accounts } = useAccount()
  const [event, setEvent] = useState<EventDetail | null>(null)
  const [items, setItems] = useState<EventBookingItem[]>([])
  const [tab, setTab] = useState<string>('requested')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!selectedAccountId || !eventId) return
    setLoading(true)
    setError(null)
    try {
      const filters = tab === 'all' ? {} : { status: tab }
      const [evRes, listRes] = await Promise.all([
        event == null ? eventsApi.getEvent(selectedAccountId, eventId) : Promise.resolve(event),
        eventsApi.listBookings(selectedAccountId, eventId, filters),
      ])
      setEvent(evRes)
      setItems(listRes.items)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountId, eventId, tab])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (!eventId) {
    return <div className="p-4 text-red-700">id クエリが必要です</div>
  }

  async function decide(id: string, action: 'confirm' | 'reject') {
    if (!selectedAccountId || !eventId) return
    let reason: string | undefined
    if (action === 'reject') {
      const r = window.prompt('拒否理由（任意・admin内部メモ。友だちには固定文面）')
      if (r === null) return
      reason = r || undefined
    }
    setBusy(true)
    try {
      await eventsApi.decideBooking(selectedAccountId, eventId, id, action, reason)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function adminCancel(id: string) {
    if (!selectedAccountId || !eventId) return
    if (!confirm('運営側でキャンセルしますか？友だちにLINE通知が送られます。')) return
    setBusy(true)
    try {
      await eventsApi.adminCancelBooking(selectedAccountId, eventId, id)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function markStatus(id: string, status: 'attended' | 'no_show') {
    if (!selectedAccountId || !eventId) return
    setBusy(true)
    try {
      await eventsApi.updateBooking(selectedAccountId, eventId, id, { status })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Header title={event?.name ?? 'イベント予約管理'} />
      <div className="p-6 max-w-6xl mx-auto">
        <div className="mb-4 flex items-center gap-2 text-sm">
          <Link href="/events" className="text-blue-600 hover:underline">イベント一覧</Link>
          <span className="text-gray-400">/</span>
          <Link href={`/events/edit?id=${eventId}`} className="text-blue-600 hover:underline">
            {event?.name ?? '編集'}
          </Link>
          <span className="text-gray-400">/</span>
          <span className="text-gray-700">予約管理</span>
        </div>

        <div className="mb-4">
          <h1 className="text-2xl font-bold text-gray-900">{event?.name ?? 'イベント予約管理'}</h1>
          <p className="text-sm text-gray-500 mt-0.5">予約の承認・キャンセル・出欠管理</p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="flex border-b border-gray-200 overflow-x-auto">
            {STATUS_TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                  tab === t.key
                    ? 'border-blue-600 text-blue-600 bg-blue-50'
                    : 'border-transparent text-gray-600 hover:bg-gray-50'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="p-12 text-center text-gray-500">読み込み中...</div>
          ) : items.length === 0 ? (
            <div className="p-12 text-center text-gray-500 text-sm">
              該当する予約はありません
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">友だち</th>
                    <th className="text-left px-4 py-2 font-medium">経由アカ</th>
                    <th className="text-left px-4 py-2 font-medium">予約枠</th>
                    <th className="text-left px-4 py-2 font-medium">状態</th>
                    <th className="text-left px-4 py-2 font-medium">受付日時</th>
                    <th className="text-right px-4 py-2 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((b) => {
                    const acct = accounts.find((a) => a.id === b.line_account_id)
                    const accountLabel = acct
                      ? `${acct.country ? acct.country + ' ' : ''}${acct.name}`
                      : (b.line_account_id ?? '').slice(0, 8)
                    return (
                    <tr key={b.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-800">
                        {b.friend_display_name ?? b.friend_id.slice(0, 8)}
                      </td>
                      <td className="px-4 py-3 text-gray-700 text-xs">{accountLabel}</td>
                      <td className="px-4 py-3 text-gray-700">{formatJp(b.slot_starts_at)}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge[b.status] ?? 'bg-gray-100'}`}>
                          {STATUS_TABS.find((t) => t.key === b.status)?.label ?? b.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{formatJp(b.requested_at)}</td>
                      <td className="px-4 py-3 text-right">
                        {b.status === 'requested' && (
                          <div className="inline-flex gap-1.5">
                            <button
                              onClick={() => decide(b.id, 'confirm')}
                              disabled={busy}
                              className="px-3 py-1 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 disabled:opacity-50"
                            >
                              承認
                            </button>
                            <button
                              onClick={() => decide(b.id, 'reject')}
                              disabled={busy}
                              className="px-3 py-1 bg-gray-500 text-white rounded-lg text-xs font-medium hover:bg-gray-600 disabled:opacity-50"
                            >
                              拒否
                            </button>
                          </div>
                        )}
                        {b.status === 'confirmed' && (
                          <div className="inline-flex gap-1.5">
                            <button
                              onClick={() => markStatus(b.id, 'attended')}
                              disabled={busy}
                              className="px-3 py-1 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
                            >
                              参加済
                            </button>
                            <button
                              onClick={() => markStatus(b.id, 'no_show')}
                              disabled={busy}
                              className="px-3 py-1 bg-red-500 text-white rounded-lg text-xs font-medium hover:bg-red-600 disabled:opacity-50"
                            >
                              無断
                            </button>
                            <button
                              onClick={() => adminCancel(b.id)}
                              disabled={busy}
                              className="px-3 py-1 border border-gray-300 rounded-lg text-xs font-medium hover:bg-white disabled:opacity-50"
                            >
                              キャンセル
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

export default function EventBookingsPage() {
  return (
    <Suspense fallback={<div className="p-4 text-gray-500">読み込み中...</div>}>
      <BookingsInner />
    </Suspense>
  )
}
