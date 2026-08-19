'use client'

import { useState, useEffect } from 'react'

interface PerAccountBreakdown {
  accountId: string
  accountName: string
  sendCount: number
}

interface SendConfirmDialogProps {
  title: string
  targetCount: number
  accountName: string
  /** true で multi-account 配信としてレンダリングする (perAccount=[] でも単アカ表示にしない). */
  isMultiAccount?: boolean
  perAccount?: PerAccountBreakdown[]
  onConfirm: () => void
  onCancel: () => void
}

export default function SendConfirmDialog({ title, targetCount, accountName, isMultiAccount, perAccount, onConfirm, onCancel }: SendConfirmDialogProps) {
  const [countdown, setCountdown] = useState(3)

  useEffect(() => {
    if (countdown <= 0) return
    const timer = setTimeout(() => setCountdown(c => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [countdown])

  const showBreakdown = isMultiAccount === true

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-sm w-full p-6">
        <h3 className="text-base font-semibold text-gray-900 mb-4">配信を送信しますか？</h3>
        <dl className="space-y-2 text-sm mb-4">
          <div className="flex justify-between">
            <dt className="text-gray-500">タイトル</dt>
            <dd className="text-gray-900 font-medium">{title}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">対象</dt>
            <dd className="text-gray-900 font-medium">{targetCount.toLocaleString('ja-JP')}人</dd>
          </div>
          {showBreakdown ? (
            <div>
              <dt className="text-gray-500 mb-1">配信先</dt>
              <dd className="space-y-1 mt-1 border-t border-gray-100 pt-2">
                {perAccount === undefined ? (
                  // データ未取得 (preview-count 読み込み中 or 失敗)。"全アカウント無効" と
                  // 誤表示しないように loading 表示にする。
                  <p className="text-xs text-gray-400">読み込み中...</p>
                ) : perAccount.length > 0 ? (
                  perAccount.map((p) => (
                    <div key={p.accountId} className="flex justify-between text-xs">
                      <span className="text-gray-700">{p.accountName}</span>
                      <span className="text-gray-900 font-medium">{p.sendCount.toLocaleString('ja-JP')}通</span>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-amber-600">送信可能なアカウントがありません（全アカウント無効）</p>
                )}
              </dd>
            </div>
          ) : (
            <div className="flex justify-between">
              <dt className="text-gray-500">アカウント</dt>
              <dd className="text-gray-900 font-medium">{accountName}</dd>
            </div>
          )}
        </dl>
        <p className="text-xs text-amber-600 mb-4">送信後は取り消せません</p>
        <div className="flex gap-2">
          <button
            onClick={onConfirm}
            disabled={countdown > 0}
            className="flex-1 px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-opacity"
            style={{ backgroundColor: '#06C755' }}
          >
            {countdown > 0 ? `送信する (${countdown})` : '送信する'}
          </button>
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2 min-h-[44px] text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            キャンセル
          </button>
        </div>
      </div>
    </div>
  )
}
