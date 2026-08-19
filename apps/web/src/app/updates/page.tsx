'use client'

import { useEffect, useState } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL!
// self-update を構成した環境 (create-line-harness セットアップ) でのみ設定される。
// 未設定 = 自動アップデート非構成環境なので、この画面は fetch せず案内のみ表示する。
const ADMIN_KEY = process.env.NEXT_PUBLIC_ADMIN_API_KEY
const MANUAL_UPDATE_GUIDE_URL =
  'https://github.com/Shudesu/line-harness-oss/blob/main/docs/wiki/26-Manual-Update.md' 

interface Row {
  id: string
  started_at: number
  completed_at: number | null
  from_version: string
  to_version: string
  status: string
  error: string | null
  rollback_expires_at: number | null
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; rows: Row[] }
  | { kind: 'unconfigured' }
  | { kind: 'error'; message: string }

async function fetchHistory(adminKey: string): Promise<Row[]> {
  const r = await fetch(`${API_URL}/admin/update/history`, {
    headers: { 'x-admin-api-key': adminKey },
  })
  if (!r.ok) throw new Error(`history fetch ${r.status}`)
  const j = (await r.json()) as { history: Row[] }
  return j.history
}

export default function UpdatesPage() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })

  useEffect(() => {
    if (!ADMIN_KEY) {
      setState({ kind: 'unconfigured' })
      return
    }
    fetchHistory(ADMIN_KEY)
      .then((rows) => setState({ kind: 'ready', rows }))
      .catch((e) => {
        // 401/403 = キー不一致 or 未構成。ネットワーク失敗も含め、
        // 運用者を驚かせる赤エラーではなく状況の説明を出す。
        const msg = e instanceof Error ? e.message : String(e)
        if (/ 40[13]$/.test(msg)) setState({ kind: 'unconfigured' })
        else setState({ kind: 'error', message: msg })
      })
  }, [])

  const rows = state.kind === 'ready' ? state.rows : []

  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-xl font-semibold mb-4">アップデート履歴</h1>
      {state.kind === 'unconfigured' && (
        <div className="text-gray-600 bg-gray-50 p-4 rounded mb-4 text-sm leading-relaxed">
          この環境では自動アップデートが構成されていないため、履歴はありません。
          <br />
          自動アップデートは <code className="text-xs">create-line-harness</code>{' '}
          でセットアップした環境で利用できます。自前でデプロイしている場合は{' '}
          <a
            className="underline"
            href={MANUAL_UPDATE_GUIDE_URL}
            target="_blank"
            rel="noreferrer"
          >
            手動アップデートガイド
          </a>{' '}
          をご覧ください。
        </div>
      )}
      {state.kind === 'error' && (
        <div className="text-amber-800 bg-amber-50 p-3 rounded mb-4 text-sm">
          履歴を取得できませんでした（{state.message}）。時間をおいて再読み込みしてください。
        </div>
      )}
      {state.kind === 'ready' && rows.length === 0 && (
        <p className="text-gray-500 text-sm">履歴はまだありません。</p>
      )}
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-gray-600 border-b">
              <tr>
                <th className="py-2 pr-4">開始</th>
                <th className="py-2 pr-4">From → To</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2">Rollback</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="py-2 pr-4">
                    {new Date(r.started_at).toLocaleString('ja-JP', {
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs">
                    {r.from_version} → {r.to_version}
                  </td>
                  <td className="py-2 pr-4">
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${statusClass(r.status)}`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="py-2">
                    {r.status === 'success' &&
                    r.rollback_expires_at &&
                    Date.now() < r.rollback_expires_at ? (
                      <button
                        onClick={() =>
                          alert('rollback not implemented in MVP — use CLI')
                        }
                        className="underline text-blue-600 text-xs"
                      >
                        Rollback
                      </button>
                    ) : (
                      <span className="text-gray-400 text-xs">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function statusClass(s: string): string {
  if (s === 'success') return 'bg-green-100 text-green-800'
  if (s === 'rolled_back') return 'bg-amber-100 text-amber-800'
  if (s === 'failed') return 'bg-red-100 text-red-800'
  if (s === 'running') return 'bg-blue-100 text-blue-800'
  return 'bg-gray-100 text-gray-800'
}
