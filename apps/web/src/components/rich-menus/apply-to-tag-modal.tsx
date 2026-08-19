'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'

type Tag = { id: string; name: string; color: string }

type Props = {
  groupId: string
  groupName: string
  onClose: () => void
}

type Mode =
  | { kind: 'tag'; tagId: string }
  | { kind: 'all-followers' }
  | { kind: 'set-default' }

export function ApplyToTagModal({ groupId, groupName, onClose }: Props) {
  const [tags, setTags] = useState<Tag[]>([])
  const [mode, setMode] = useState<Mode>({ kind: 'all-followers' })
  const [phase, setPhase] = useState<'config' | 'running' | 'done' | 'error'>(
    'config',
  )
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{
    chunks: number
    total: number
    message?: string
    mode?: string
  } | null>(null)

  useEffect(() => {
    api.tags
      .list()
      .then((r) => {
        if (r.success) setTags(r.data ?? [])
      })
      .catch(() => {
        // タグ取得失敗 = 一覧空のまま
      })
  }, [])

  async function apply() {
    // 「全員のデフォルト」は影響範囲が大きいので強い確認。
    if (mode.kind === 'set-default') {
      if (
        !confirm(
          'このリッチメニューを「LINE 公式アカウントの全員のデフォルト」に設定します。\n\n' +
            '・新規友だちも含め、特別な設定をしていない全員に表示されます\n' +
            '・同アカウント内で他のメニューがデフォルトに設定されていた場合、そちらは解除されます\n\n' +
            '続行しますか？',
        )
      )
        return
    }
    setPhase('running')
    setError(null)
    try {
      const params =
        mode.kind === 'tag'
          ? { mode: 'bulk-link' as const, tagId: mode.tagId }
          : mode.kind === 'all-followers'
            ? { mode: 'bulk-link' as const, tagId: null }
            : { mode: 'set-default' as const }
      const res = await api.richMenuGroups.applyToTag(groupId, params)
      if (!res.success) throw new Error(res.error ?? '適用失敗')
      setResult(res.data)
      setPhase('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPhase('error')
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">
            友だちにこのメニューを表示
          </h2>
          <p className="text-sm text-gray-500 mb-5 break-all">「{groupName}」</p>

          {phase === 'config' && (
            <>
              <div className="space-y-3 mb-5">
                <RadioOption
                  checked={mode.kind === 'all-followers'}
                  onChange={() => setMode({ kind: 'all-followers' })}
                  label="このアカウントの全員に適用"
                  description="現時点で friend 状態の友だち全員に LINE のメニューを link します。新規友だちには適用されません。"
                />
                <RadioOption
                  checked={mode.kind === 'tag'}
                  onChange={() =>
                    setMode({
                      kind: 'tag',
                      tagId: tags[0]?.id ?? '',
                    })
                  }
                  label="タグで絞り込んで適用"
                  description="指定したタグを持つ友だちだけに表示します。"
                  disabled={tags.length === 0}
                >
                  {mode.kind === 'tag' && (
                    <select
                      value={mode.tagId}
                      onChange={(e) =>
                        setMode({ kind: 'tag', tagId: e.target.value })
                      }
                      className="mt-2 block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    >
                      {tags.length === 0 ? (
                        <option value="">タグがありません</option>
                      ) : (
                        tags.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))
                      )}
                    </select>
                  )}
                </RadioOption>
                <RadioOption
                  checked={mode.kind === 'set-default'}
                  onChange={() => setMode({ kind: 'set-default' })}
                  label="全員のデフォルトに設定する"
                  description="LINE 公式アカウントのデフォルトメニューにします。新規友だちも含め全員に自動で表示されます。同アカ内の他メニューのデフォルト設定は解除されます。"
                  warn
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  キャンセル
                </button>
                <button
                  onClick={apply}
                  disabled={mode.kind === 'tag' && !mode.tagId}
                  className="px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-opacity hover:opacity-90"
                  style={{ backgroundColor: '#06C755' }}
                >
                  実行する
                </button>
              </div>
            </>
          )}

          {phase === 'running' && (
            <div className="text-center py-10 text-sm text-gray-500">
              <div className="mb-2">適用中...</div>
              <div className="text-xs text-gray-400">
                LINE Messaging API に送信しています
              </div>
            </div>
          )}

          {phase === 'done' && result && (
            <>
              <div className="bg-green-50 border border-green-200 text-green-800 text-sm p-4 rounded-lg mb-4">
                <div className="font-medium mb-1">✓ 完了しました</div>
                <div className="text-xs">
                  {result.message ??
                    `${result.total} 名の友だちに適用しました (${result.chunks} chunk)`}
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90"
                  style={{ backgroundColor: '#06C755' }}
                >
                  閉じる
                </button>
              </div>
            </>
          )}

          {phase === 'error' && (
            <>
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-4 rounded-lg mb-4">
                {error}
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  閉じる
                </button>
                <button
                  onClick={() => setPhase('config')}
                  className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90"
                  style={{ backgroundColor: '#06C755' }}
                >
                  やり直す
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function RadioOption({
  checked,
  onChange,
  label,
  description,
  warn,
  disabled,
  children,
}: {
  checked: boolean
  onChange: () => void
  label: string
  description: string
  warn?: boolean
  disabled?: boolean
  children?: React.ReactNode
}) {
  return (
    <label
      className={`block border rounded-lg p-3 transition-colors ${
        disabled
          ? 'opacity-50 cursor-not-allowed border-gray-200'
          : checked
            ? warn
              ? 'border-amber-400 bg-amber-50 cursor-pointer'
              : 'border-green-500 bg-green-50 cursor-pointer'
            : 'border-gray-200 hover:bg-gray-50 cursor-pointer'
      }`}
    >
      <div className="flex items-start gap-3">
        <input
          type="radio"
          checked={checked}
          onChange={onChange}
          disabled={disabled}
          className="mt-1"
        />
        <div className="flex-1">
          <div className="text-sm font-medium text-gray-900">{label}</div>
          <p className="text-xs text-gray-600 mt-0.5">{description}</p>
          {children}
        </div>
      </div>
    </label>
  )
}
