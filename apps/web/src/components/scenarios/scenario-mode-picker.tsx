'use client'

import { useEffect, useState } from 'react'
import type { DeliveryMode, ScenarioTriggerType, Tag } from '@line-crm/shared'
import { api } from '@/lib/api'

interface Props {
  open: boolean
  onClose: () => void
  onCreate: (input: {
    name: string
    triggerType: ScenarioTriggerType
    triggerTagId: string | null
    deliveryMode: DeliveryMode
  }) => Promise<void>
}

const triggerOptions: Array<{
  value: ScenarioTriggerType
  label: string
  description: string
}> = [
  {
    value: 'friend_add',
    label: '友だち追加時',
    description: '新規友だち追加のタイミングで自動開始',
  },
  {
    value: 'tag_added',
    label: 'タグ付与時',
    description: '指定タグが付いたタイミングで自動開始（カスケード運用向け）',
  },
  {
    value: 'manual',
    label: '手動',
    description: '管理画面 / API から明示的に開始するときだけ流れる',
  },
]

export default function ScenarioModePicker({ open, onClose, onCreate }: Props) {
  const [stage, setStage] = useState<'pick' | 'name'>('pick')
  const [mode, setMode] = useState<DeliveryMode>('elapsed')
  const [name, setName] = useState('')
  const [triggerType, setTriggerType] = useState<ScenarioTriggerType>('friend_add')
  const [triggerTagId, setTriggerTagId] = useState<string>('')
  const [tags, setTags] = useState<Tag[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // tags 一覧を取得 (tag_added 選択時のドロップダウン用)
  useEffect(() => {
    if (!open) return
    api.tags
      .list()
      .then((res) => {
        if (res.success) setTags(res.data)
      })
      .catch(() => {})
  }, [open])

  if (!open) return null

  const reset = () => {
    setStage('pick')
    setName('')
    setMode('elapsed')
    setTriggerType('friend_add')
    setTriggerTagId('')
    setError('')
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const handleCreate = async () => {
    if (!name.trim()) {
      setError('シナリオ名を入力してください')
      return
    }
    if (triggerType === 'tag_added' && !triggerTagId) {
      setError('トリガータグを選択してください')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      await onCreate({
        name,
        triggerType,
        triggerTagId: triggerType === 'tag_added' ? triggerTagId : null,
        deliveryMode: mode,
      })
      reset()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : '作成に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={handleClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl max-w-2xl w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {stage === 'pick' && (
          <>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">配信方式を選択</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <button
                onClick={() => {
                  setMode('absolute_time')
                  setStage('name')
                }}
                className="text-left border border-gray-200 rounded-lg p-5 hover:border-amber-500 hover:bg-amber-50 transition-colors"
              >
                <div className="text-2xl mb-2">🕐</div>
                <h3 className="font-semibold text-gray-900 mb-1">毎日◯時に配信</h3>
                <p className="text-sm text-gray-600 mb-2">例: 翌日 朝 9:00</p>
                <p className="text-xs text-green-700">✅ 深夜配信なし</p>
              </button>
              <button
                onClick={() => {
                  setMode('elapsed')
                  setStage('name')
                }}
                className="text-left border border-gray-200 rounded-lg p-5 hover:border-blue-500 hover:bg-blue-50 transition-colors"
              >
                <div className="text-2xl mb-2">⏱</div>
                <h3 className="font-semibold text-gray-900 mb-1">追加◯時間後に配信</h3>
                <p className="text-sm text-gray-600 mb-2">例: 追加から 5 時間後</p>
                <p className="text-xs text-red-600">⚠ 深夜にも配信され得る</p>
              </button>
            </div>
            <div className="mt-4 text-center">
              <button
                onClick={() => {
                  setMode('relative')
                  setStage('name')
                }}
                className="text-xs text-gray-400 hover:text-gray-600 underline"
              >
                既存方式（前ステップから N 分後）で作成
              </button>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                onClick={handleClose}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                キャンセル
              </button>
            </div>
          </>
        )}
        {stage === 'name' && (
          <>
            <h2 className="text-lg font-semibold text-gray-900 mb-1">シナリオを作成</h2>
            <p className="text-xs text-gray-500 mb-4">
              配信方式:{' '}
              <span className="font-medium">
                {mode === 'absolute_time'
                  ? '時刻で指定'
                  : mode === 'elapsed'
                    ? '経過時間で指定'
                    : '既存方式 (relative)'}
              </span>
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  シナリオ名 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  autoFocus
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder="例: 友だち追加ウェルカム"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && triggerType !== 'tag_added' && !submitting) handleCreate()
                  }}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">いつ開始する？</label>
                <div className="space-y-2">
                  {triggerOptions.map((opt) => (
                    <label
                      key={opt.value}
                      className={`flex items-start gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${
                        triggerType === opt.value
                          ? 'border-green-500 bg-green-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="triggerType"
                        value={opt.value}
                        checked={triggerType === opt.value}
                        onChange={() => setTriggerType(opt.value)}
                        className="mt-0.5"
                      />
                      <div className="flex-1">
                        <div className="text-sm font-medium text-gray-900">{opt.label}</div>
                        <div className="text-xs text-gray-500">{opt.description}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {triggerType === 'tag_added' && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    トリガータグ <span className="text-red-500">*</span>
                  </label>
                  <select
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                    value={triggerTagId}
                    onChange={(e) => setTriggerTagId(e.target.value)}
                  >
                    <option value="">-- 選択してください --</option>
                    {tags.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-400 mt-0.5">
                    このタグが友だちに付与されたら、自動でこのシナリオを開始します
                  </p>
                </div>
              )}
            </div>

            {error && <p className="text-xs text-red-600 mt-3">{error}</p>}

            <div className="mt-5 flex justify-between gap-2">
              <button
                onClick={() => setStage('pick')}
                disabled={submitting}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg disabled:opacity-50"
              >
                ← 戻る
              </button>
              <button
                onClick={handleCreate}
                disabled={submitting}
                className="px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50"
                style={{ backgroundColor: '#06C755' }}
              >
                {submitting ? '作成中...' : '作成して編集へ'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
