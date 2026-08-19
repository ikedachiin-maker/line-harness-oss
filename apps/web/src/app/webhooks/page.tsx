'use client'

import { useState, useEffect, useCallback } from 'react'
import Header from '@/components/layout/header'
import { api } from '@/lib/api'
import CcPromptButton from '@/components/cc-prompt-button'
import type { IncomingWebhook, OutgoingWebhook } from '@line-crm/shared'

type Tab = 'incoming' | 'outgoing'

const MIN_SECRET_LENGTH = 32

const ccPrompts = [
  {
    title: 'Webhook設定ガイド',
    prompt: `Webhookの設定手順をガイドしてください。
1. 受信Webhook（Incoming）の作成とエンドポイントURLの設定方法
2. 送信Webhook（Outgoing）のURL・イベントタイプ・シークレット設定
3. LINE公式アカウントとのWebhook連携設定手順
手順を示してください。`,
  },
  {
    title: 'Webhookデバッグ',
    prompt: `Webhookの動作確認とデバッグをサポートしてください。
1. 受信・送信Webhookの有効/無効ステータスを確認
2. Webhookのテスト送信と応答検証の手順
3. よくあるエラーパターンとトラブルシューティング方法
手順を示してください。`,
  },
]

// Generate a 32-char URL-safe random secret in the browser. 24 random bytes
// produce exactly 32 base64 characters; remap +/ to -/_ instead of stripping
// so we always end up with 32 chars (stripping would drop the count).
function generateSecret(): string {
  const buf = new Uint8Array(24)
  crypto.getRandomValues(buf)
  let s = ''
  for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i])
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

export default function WebhooksPage() {
  const [tab, setTab] = useState<Tab>('incoming')
  const [incoming, setIncoming] = useState<IncomingWebhook[]>([])
  const [outgoing, setOutgoing] = useState<OutgoingWebhook[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)

  const [inForm, setInForm] = useState({ name: '', sourceType: '', secret: '' })
  const [outForm, setOutForm] = useState({ name: '', url: '', eventTypes: '', secret: '' })

  // After a successful create the API returns the secret exactly once.
  // Show it to the operator with a copy affordance, then forget it.
  const [createdSecret, setCreatedSecret] = useState<{ name: string; secret: string } | null>(null)
  const [secretCopied, setSecretCopied] = useState(false)

  // Rotate-secret modal state. Used to recover legacy webhooks deactivated
  // by migration 034, or to rotate a leaked secret in place.
  const [rotateTarget, setRotateTarget] = useState<
    | { kind: 'incoming' | 'outgoing'; id: string; name: string; activate: boolean }
    | null
  >(null)
  const [rotateSecretValue, setRotateSecretValue] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [inRes, outRes] = await Promise.all([
        api.webhooks.incoming.list(),
        api.webhooks.outgoing.list(),
      ])
      if (inRes.success) setIncoming(inRes.data)
      else setError(inRes.error)
      if (outRes.success) setOutgoing(outRes.data)
      else setError(outRes.error)
    } catch {
      setError('データの読み込みに失敗しました。もう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleToggleIncoming = async (id: string, currentActive: boolean) => {
    try {
      await api.webhooks.incoming.update(id, { isActive: !currentActive })
      load()
    } catch {
      setError('更新に失敗しました')
    }
  }

  const handleToggleOutgoing = async (id: string, currentActive: boolean) => {
    try {
      await api.webhooks.outgoing.update(id, { isActive: !currentActive })
      load()
    } catch {
      setError('更新に失敗しました')
    }
  }

  const handleDeleteIncoming = async (id: string) => {
    if (!confirm('この受信Webhookを削除しますか？')) return
    try {
      await api.webhooks.incoming.delete(id)
      load()
    } catch {
      setError('削除に失敗しました')
    }
  }

  const handleDeleteOutgoing = async (id: string) => {
    if (!confirm('この送信Webhookを削除しますか？')) return
    try {
      await api.webhooks.outgoing.delete(id)
      load()
    } catch {
      setError('削除に失敗しました')
    }
  }

  const handleCreateIncoming = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!inForm.name) return
    if (inForm.secret.length < MIN_SECRET_LENGTH) {
      setError(`シークレットは最低${MIN_SECRET_LENGTH}文字必要です`)
      return
    }
    try {
      const res = await api.webhooks.incoming.create({
        name: inForm.name,
        sourceType: inForm.sourceType || undefined,
        secret: inForm.secret,
      })
      if (!res.success) {
        setError(res.error)
        return
      }
      setCreatedSecret({ name: res.data.name, secret: res.data.secret })
      setSecretCopied(false)
      setInForm({ name: '', sourceType: '', secret: '' })
      setShowCreate(false)
      load()
    } catch {
      setError('作成に失敗しました')
    }
  }

  const handleCreateOutgoing = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!outForm.name || !outForm.url) return
    if (!isHttpsUrl(outForm.url)) {
      setError('URLは https:// から始まる必要があります')
      return
    }
    if (outForm.secret.length < MIN_SECRET_LENGTH) {
      setError(`シークレットは最低${MIN_SECRET_LENGTH}文字必要です`)
      return
    }
    try {
      const eventTypes = outForm.eventTypes
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      const res = await api.webhooks.outgoing.create({
        name: outForm.name,
        url: outForm.url,
        eventTypes,
        secret: outForm.secret,
      })
      if (!res.success) {
        setError(res.error)
        return
      }
      setCreatedSecret({ name: res.data.name, secret: res.data.secret })
      setSecretCopied(false)
      setOutForm({ name: '', url: '', eventTypes: '', secret: '' })
      setShowCreate(false)
      load()
    } catch {
      setError('作成に失敗しました')
    }
  }

  const copySecret = async (secret: string) => {
    try {
      await navigator.clipboard.writeText(secret)
      setSecretCopied(true)
    } catch {
      // ignore — operator can still copy manually
    }
  }

  const handleRotateSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!rotateTarget) return
    if (rotateSecretValue.length < MIN_SECRET_LENGTH) {
      setError(`シークレットは最低${MIN_SECRET_LENGTH}文字必要です`)
      return
    }
    try {
      const payload = { secret: rotateSecretValue, isActive: rotateTarget.activate || undefined }
      const res =
        rotateTarget.kind === 'incoming'
          ? await api.webhooks.incoming.update(rotateTarget.id, payload)
          : await api.webhooks.outgoing.update(rotateTarget.id, payload)
      if (!res.success) {
        setError(res.error)
        return
      }
      setRotateTarget(null)
      setRotateSecretValue('')
      load()
    } catch {
      setError('シークレットの更新に失敗しました')
    }
  }

  const endpointUrl = (id: string) =>
    `${typeof window !== 'undefined' ? window.location.origin : ''}/api/webhooks/incoming/${id}/receive`

  return (
    <div>
      <Header
        title="Webhook管理"
        action={
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#06C755' }}
          >
            {showCreate ? 'キャンセル' : '+ 新規Webhook'}
          </button>
        }
      />

      {/* Rotate-secret modal — used to recover legacy webhooks or rotate. */}
      {rotateTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <form onSubmit={handleRotateSubmit} className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">
              「{rotateTarget.name}」のシークレットを{rotateTarget.activate ? '設定して有効化' : '更新'}
            </h2>
            <p className="text-sm text-gray-600 mb-4">
              新しいシークレットを設定します。
              <strong className="text-red-600">設定後は今回限り画面に表示されません。</strong>
              控えておいてから「保存」を押してください。
            </p>
            <div className="flex gap-2 mb-4">
              <input
                value={rotateSecretValue}
                onChange={(e) => setRotateSecretValue(e.target.value)}
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
                placeholder="ランダムな英数字32文字以上"
                required
                minLength={MIN_SECRET_LENGTH}
                autoFocus
              />
              <button
                type="button"
                onClick={() => setRotateSecretValue(generateSecret())}
                className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 whitespace-nowrap"
              >
                自動生成
              </button>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => {
                  setRotateTarget(null)
                  setRotateSecretValue('')
                }}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                キャンセル
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-sm rounded-lg text-white font-medium"
                style={{ backgroundColor: '#06C755' }}
              >
                保存
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Created-secret modal — shown ONCE after a successful create. */}
      {createdSecret && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">
              シークレットを保存してください
            </h2>
            <p className="text-sm text-gray-600 mb-4">
              「{createdSecret.name}」を作成しました。
              <strong className="text-red-600">このシークレットは今後二度と表示されません。</strong>
              閉じる前に必ず安全な場所に保存してください。
            </p>
            <div className="bg-gray-50 border border-gray-200 rounded p-3 mb-4">
              <code className="text-sm break-all">{createdSecret.secret}</code>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => copySecret(createdSecret.secret)}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                {secretCopied ? 'コピー済み' : 'クリップボードにコピー'}
              </button>
              <button
                onClick={() => {
                  setCreatedSecret(null)
                  setSecretCopied(false)
                }}
                className="px-4 py-2 text-sm rounded-lg text-white font-medium"
                style={{ backgroundColor: '#06C755' }}
              >
                保存しました
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
        <button
          onClick={() => { setTab('incoming'); setShowCreate(false) }}
          className={`px-4 py-2 min-h-[44px] text-sm font-medium rounded-md transition-colors ${
            tab === 'incoming'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          受信 (Incoming)
        </button>
        <button
          onClick={() => { setTab('outgoing'); setShowCreate(false) }}
          className={`px-4 py-2 min-h-[44px] text-sm font-medium rounded-md transition-colors ${
            tab === 'outgoing'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          送信 (Outgoing)
        </button>
      </div>

      {/* Create forms */}
      {showCreate && tab === 'incoming' && (
        <form onSubmit={handleCreateIncoming} className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">受信Webhook作成</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">名前</label>
              <input
                value={inForm.name}
                onChange={(e) => setInForm({ ...inForm, name: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="LINE公式アカウント"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ソースタイプ</label>
              <input
                value={inForm.sourceType}
                onChange={(e) => setInForm({ ...inForm, sourceType: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="line"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                シークレット (最低{MIN_SECRET_LENGTH}文字)
              </label>
              <div className="flex gap-2">
                <input
                  value={inForm.secret}
                  onChange={(e) => setInForm({ ...inForm, secret: e.target.value })}
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
                  placeholder="ランダムな英数字32文字以上"
                  required
                  minLength={MIN_SECRET_LENGTH}
                />
                <button
                  type="button"
                  onClick={() => setInForm({ ...inForm, secret: generateSecret() })}
                  className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 whitespace-nowrap"
                >
                  自動生成
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                外部システムが Webhook 受信時に X-Webhook-Signature ヘッダで HMAC-SHA256 署名する際に使用します。
              </p>
            </div>
          </div>
          <button
            type="submit"
            className="mt-4 px-4 py-2 rounded-lg text-white text-sm font-medium"
            style={{ backgroundColor: '#06C755' }}
          >
            作成
          </button>
        </form>
      )}

      {showCreate && tab === 'outgoing' && (
        <form onSubmit={handleCreateOutgoing} className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">送信Webhook作成</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">名前</label>
              <input
                value={outForm.name}
                onChange={(e) => setOutForm({ ...outForm, name: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="外部CRM連携"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">URL (https:// 必須)</label>
              <input
                type="url"
                value={outForm.url}
                onChange={(e) => setOutForm({ ...outForm, url: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="https://example.com/webhook"
                pattern="https://.*"
                required
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">イベントタイプ (カンマ区切り、* で全イベント)</label>
              <input
                value={outForm.eventTypes}
                onChange={(e) => setOutForm({ ...outForm, eventTypes: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="friend.added, message.received"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                シークレット (最低{MIN_SECRET_LENGTH}文字)
              </label>
              <div className="flex gap-2">
                <input
                  value={outForm.secret}
                  onChange={(e) => setOutForm({ ...outForm, secret: e.target.value })}
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
                  placeholder="ランダムな英数字32文字以上"
                  required
                  minLength={MIN_SECRET_LENGTH}
                />
                <button
                  type="button"
                  onClick={() => setOutForm({ ...outForm, secret: generateSecret() })}
                  className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 whitespace-nowrap"
                >
                  自動生成
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                送信時に X-Webhook-Signature ヘッダで HMAC-SHA256 署名するために使われます。受信側で同じシークレットで検証してください。
              </p>
            </div>
          </div>
          <button
            type="submit"
            className="mt-4 px-4 py-2 rounded-lg text-white text-sm font-medium"
            style={{ backgroundColor: '#06C755' }}
          >
            作成
          </button>
        </form>
      )}

      {/* Loading */}
      {loading ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="px-4 py-4 border-b border-gray-100 flex items-center gap-4 animate-pulse">
              <div className="flex-1 space-y-2">
                <div className="h-3 bg-gray-200 rounded w-48" />
                <div className="h-2 bg-gray-100 rounded w-32" />
              </div>
              <div className="h-5 bg-gray-100 rounded-full w-16" />
              <div className="h-3 bg-gray-100 rounded w-24" />
            </div>
          ))}
        </div>
      ) : tab === 'incoming' ? (
        /* Incoming table */
        incoming.length === 0 && !showCreate ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
            <p className="text-gray-500">受信Webhookがありません。「新規Webhook」から作成してください。</p>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">名前</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">ソースタイプ</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">エンドポイントURL</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">シークレット</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">ステータス</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">作成日</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {incoming.map((wh) => (
                  <tr key={wh.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{wh.name}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{wh.sourceType || '-'}</td>
                    <td className="px-4 py-3">
                      <code className="text-xs bg-gray-100 px-2 py-1 rounded text-gray-700 break-all">
                        {endpointUrl(wh.id)}
                      </code>
                    </td>
                    <td className="px-4 py-3">
                      {wh.hasSecret ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                          設定済
                        </span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                          未設定
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleToggleIncoming(wh.id, wh.isActive)}
                        disabled={!wh.hasSecret && !wh.isActive}
                        className={`text-xs px-2 py-0.5 rounded-full disabled:opacity-50 disabled:cursor-not-allowed ${
                          wh.isActive
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-500'
                        }`}
                        title={!wh.hasSecret && !wh.isActive ? 'シークレット未設定のため有効化できません' : ''}
                      >
                        {wh.isActive ? '有効' : '無効'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {new Date(wh.createdAt).toLocaleDateString('ja-JP')}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        onClick={() => {
                          setRotateTarget({
                            kind: 'incoming',
                            id: wh.id,
                            name: wh.name,
                            activate: !wh.hasSecret,
                          })
                          setRotateSecretValue('')
                        }}
                        className="text-xs text-gray-600 hover:text-gray-900 mr-3"
                      >
                        {wh.hasSecret ? 'シークレット更新' : 'シークレット設定'}
                      </button>
                      <button
                        onClick={() => handleDeleteIncoming(wh.id)}
                        className="text-red-500 hover:text-red-700 text-sm"
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        )
      ) : (
        /* Outgoing table */
        outgoing.length === 0 && !showCreate ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
            <p className="text-gray-500">送信Webhookがありません。「新規Webhook」から作成してください。</p>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">名前</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">URL</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">イベントタイプ</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">シークレット</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">ステータス</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">作成日</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {outgoing.map((wh) => {
                  const hasValidUrl = isHttpsUrl(wh.url)
                  const canActivate = wh.hasSecret && hasValidUrl
                  const blockedReason = !canActivate
                    ? !wh.hasSecret && !hasValidUrl
                      ? 'シークレット未設定 + URL が https:// ではないため有効化できません'
                      : !wh.hasSecret
                        ? 'シークレット未設定のため有効化できません'
                        : 'URL が https:// ではないため有効化できません'
                    : ''
                  return (
                  <tr key={wh.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{wh.name}</td>
                    <td className="px-4 py-3">
                      <code className="text-xs bg-gray-100 px-2 py-1 rounded text-gray-700 break-all">
                        {wh.url}
                      </code>
                      {!hasValidUrl && (
                        <p className="text-xs text-amber-700 mt-1">
                          ※ https:// で始まる完全な URL に作り直してください
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {wh.eventTypes.map((et) => (
                          <span
                            key={et}
                            className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700"
                          >
                            {et}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {wh.hasSecret ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                          設定済
                        </span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                          未設定
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleToggleOutgoing(wh.id, wh.isActive)}
                        disabled={!canActivate && !wh.isActive}
                        className={`text-xs px-2 py-0.5 rounded-full disabled:opacity-50 disabled:cursor-not-allowed ${
                          wh.isActive
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-500'
                        }`}
                        title={blockedReason}
                      >
                        {wh.isActive ? '有効' : '無効'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {new Date(wh.createdAt).toLocaleDateString('ja-JP')}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        onClick={() => {
                          setRotateTarget({
                            kind: 'outgoing',
                            id: wh.id,
                            name: wh.name,
                            activate: hasValidUrl && !wh.hasSecret,
                          })
                          setRotateSecretValue('')
                        }}
                        className="text-xs text-gray-600 hover:text-gray-900 mr-3"
                      >
                        {wh.hasSecret ? 'シークレット更新' : 'シークレット設定'}
                      </button>
                      <button
                        onClick={() => handleDeleteOutgoing(wh.id)}
                        className="text-red-500 hover:text-red-700 text-sm"
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
            </div>
          </div>
        )
      )}
      <CcPromptButton prompts={ccPrompts} />
    </div>
  )
}
