'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'

interface Props {
  open: boolean
  scenarioId: string
  onClose: () => void
}

interface PreviewStep {
  stepOrder: number
  deliveryAt: string
  deliveryAtLabel: string
  messageType: string
  messageContent: string
}

function nowJstAsLocalInput(): string {
  // JST clock-time as YYYY-MM-DDTHH:MM for <input type="datetime-local">
  const d = new Date(Date.now() + 9 * 60 * 60_000)
  return d.toISOString().slice(0, 16)
}

export default function BulkPreviewModal({ open, scenarioId, onClose }: Props) {
  const [startAt, setStartAt] = useState(() => nowJstAsLocalInput())
  const [steps, setSteps] = useState<PreviewStep[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError('')
    const iso = startAt + ':00+09:00'
    api.scenarios
      .preview(scenarioId, iso)
      .then((res) => {
        if (res.success) setSteps(res.data.steps)
        else setError(res.error)
      })
      .catch(() => setError('プレビューの読み込みに失敗しました'))
      .finally(() => setLoading(false))
  }, [open, scenarioId, startAt])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl max-w-2xl w-full p-6 max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">一括プレビュー</h2>
          <button
            onClick={onClose}
            className="text-sm text-gray-500 hover:bg-gray-100 px-2 py-1 rounded"
          >
            ✕
          </button>
        </div>

        <div className="mb-4">
          <label className="block text-xs font-medium text-gray-600 mb-1">
            起点 (購読開始日時)
          </label>
          <input
            type="datetime-local"
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            value={startAt}
            onChange={(e) => setStartAt(e.target.value)}
          />
        </div>

        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

        {loading ? (
          <p className="text-sm text-gray-400">読み込み中...</p>
        ) : steps && steps.length > 0 ? (
          <div className="space-y-2">
            {steps.map((s) => (
              <details
                key={s.stepOrder}
                className="border border-gray-200 rounded-lg p-3 group"
              >
                <summary className="cursor-pointer text-sm flex items-center gap-2 list-none">
                  <span className="font-mono text-gray-500 w-8">#{s.stepOrder}</span>
                  <span className="text-gray-700 flex-1">{s.deliveryAtLabel}</span>
                  <span className="text-xs text-blue-600">{s.messageType}</span>
                  <span className="text-gray-400 group-open:rotate-90 transition-transform">▶</span>
                </summary>
                <pre className="mt-2 text-xs text-gray-700 whitespace-pre-wrap break-words bg-gray-50 p-2 rounded max-h-48 overflow-y-auto">
                  {s.messageContent}
                </pre>
              </details>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-400">ステップがありません</p>
        )}

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}
