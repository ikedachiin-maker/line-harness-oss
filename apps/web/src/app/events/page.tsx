'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import Header from '@/components/layout/header'
import { eventsApi, type EventListItem } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'

function formatJpDate(iso: string | null): string {
  if (!iso) return '日時未設定'
  return new Date(iso).toLocaleString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

export default function EventsListPage() {
  const { selectedAccountId } = useAccount()
  const [items, setItems] = useState<EventListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!selectedAccountId) return
    setLoading(true)
    setError(null)
    try {
      const res = await eventsApi.listEvents(selectedAccountId)
      setItems(res.items)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <>
      <Header title="イベント予約" />
      <div className="p-6 max-w-6xl mx-auto">
        <div className="mb-6 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">イベント一覧</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              日時を指定したイベントを作成し、LIFF 経由で友だちに予約してもらえます
            </p>
          </div>
          <Link
            href="/events/new"
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
          >
            ＋ 新しいイベント
          </Link>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center text-gray-500">
            読み込み中...
          </div>
        ) : items.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
            <div className="text-gray-700 font-medium mb-2">イベントが作成されていません</div>
            <p className="text-sm text-gray-500 mb-4">
              友だちに告知する勉強会・説明会・オフ会などをここから作成します。
            </p>
            <Link
              href="/events/new"
              className="inline-block px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
            >
              最初のイベントを作成
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map((e) => (
              <Link
                key={e.id}
                href={`/events/edit?id=${e.id}`}
                className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow"
              >
                {e.image_url ? (
                  <img
                    src={e.image_url}
                    alt={e.name}
                    className="w-full h-32 object-cover bg-gray-100"
                  />
                ) : (
                  <div className="w-full h-32 bg-gradient-to-br from-blue-100 to-blue-200" />
                )}
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="font-semibold text-gray-900 line-clamp-2 flex-1">{e.name}</div>
                    <div className="flex flex-col gap-1 shrink-0 items-end">
                      {e.is_published === 1 ? (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                          公開中
                        </span>
                      ) : (
                        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                          下書き
                        </span>
                      )}
                      {e.target_type === 'multi-account-dedup' && (() => {
                        const ids: string[] = Array.isArray(e.account_ids)
                          ? e.account_ids
                          : typeof e.account_ids === 'string'
                            ? (() => { try { return JSON.parse(e.account_ids) as string[] } catch { return [] } })()
                            : []
                        return (
                          <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
                            横断 {ids.length} アカ
                          </span>
                        )
                      })()}
                    </div>
                  </div>
                  <div className="text-xs text-gray-500 mb-3">
                    {formatJpDate(e.next_slot_starts_at)}
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-700">
                      予約 <span className="font-semibold">{e.total_active}</span>
                      {e.total_capacity != null && <span className="text-gray-400"> / {e.total_capacity}</span>}
                    </span>
                    {e.pending_count > 0 && (
                      <span className="bg-yellow-100 text-yellow-800 text-xs font-bold px-2 py-0.5 rounded-full">
                        承認待ち {e.pending_count}
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
