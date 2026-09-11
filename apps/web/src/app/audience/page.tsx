'use client'

import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import type { AudienceOverview, AudienceChannelRow, AudienceAccountRow } from '@/lib/api'
import Header from '@/components/layout/header'

/**
 * 名簿規模 — メルマガ読者数・LINE友だち数・SNSフォロワー数を1画面で見る。
 *
 * 名簿そのものはここに集めていない。各チャネルに置いたまま、人数だけを
 * 1日1回集めている。詳細は packages/db/migrations/071_audience_snapshots.sql。
 */

const CHANNEL_LABELS: Record<string, string> = {
  line: 'LINE 友だち',
  mail: 'メルマガ読者',
  x: 'X フォロワー',
  instagram: 'Instagram フォロワー',
  threads: 'Threads フォロワー',
}

const CHANNEL_ACCENTS: Record<string, string> = {
  line: 'bg-green-500',
  mail: 'bg-amber-500',
  x: 'bg-slate-800',
  instagram: 'bg-pink-500',
  threads: 'bg-zinc-600',
}

function channelLabel(channel: string): string {
  return CHANNEL_LABELS[channel] ?? channel
}

function formatNumber(n: number): string {
  return n.toLocaleString('ja-JP')
}

/**
 * 増減の表示。null は「比べる過去がまだ無い」で、0 とは意味が違う。
 * 0 を「増減なし」と出し、null を「-」と出して区別する。
 */
function Delta({ value, suffix }: { value: number | null; suffix: string }) {
  if (value === null) {
    return <span className="text-gray-400">- <span className="text-xs">{suffix}</span></span>
  }
  const color = value > 0 ? 'text-green-600' : value < 0 ? 'text-red-600' : 'text-gray-500'
  const sign = value > 0 ? '+' : ''
  return (
    <span className={color}>
      {sign}{formatNumber(value)} <span className="text-xs text-gray-400">{suffix}</span>
    </span>
  )
}

/** 収集が止まっていないか。古い数字を黙って出し続けないための印。 */
function Staleness({ capturedOn, today }: { capturedOn: string | null; today: string }) {
  if (!capturedOn) return null
  const days = Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${capturedOn}T00:00:00Z`)) / 86_400_000,
  )
  if (days <= 1) return null
  return (
    <span className="ml-2 rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
      {capturedOn} 時点（{days}日前）
    </span>
  )
}

function AccountRow({ account }: { account: AudienceAccountRow }) {
  return (
    <div className="flex items-center justify-between border-t border-gray-100 px-4 py-2 text-sm">
      <span className="text-gray-600">
        {account.accountLabel || account.accountKey}
        {account.source === 'report' && (
          <span className="ml-2 text-xs text-gray-400">外部から報告</span>
        )}
      </span>
      <span className="flex items-center gap-4">
        <span className="tabular-nums text-gray-900">{formatNumber(account.total)}</span>
        <span className="w-24 text-right tabular-nums text-xs">
          <Delta value={account.delta7d} suffix="7日" />
        </span>
      </span>
    </div>
  )
}

function ChannelCard({ channel, today }: { channel: AudienceChannelRow; today: string }) {
  const [open, setOpen] = useState(false)
  const multi = channel.accounts.length > 1

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center gap-3">
          <span className={`h-8 w-1 rounded ${CHANNEL_ACCENTS[channel.channel] ?? 'bg-gray-400'}`} />
          <div>
            <div className="text-sm text-gray-500">
              {channelLabel(channel.channel)}
              <Staleness capturedOn={channel.capturedOn} today={today} />
            </div>
            <div className="text-2xl font-semibold tabular-nums text-gray-900">
              {formatNumber(channel.total)}
            </div>
          </div>
        </div>
        <div className="text-right text-sm">
          <div><Delta value={channel.delta7d} suffix="7日" /></div>
          <div className="mt-1"><Delta value={channel.delta30d} suffix="30日" /></div>
        </div>
      </div>

      {multi && (
        <>
          <button
            onClick={() => setOpen(!open)}
            className="w-full border-t border-gray-100 px-4 py-1.5 text-left text-xs text-gray-500 hover:bg-gray-50"
          >
            {open ? '内訳を閉じる' : `内訳を見る（${channel.accounts.length}件）`}
          </button>
          {open && channel.accounts.map((a) => <AccountRow key={a.accountKey} account={a} />)}
        </>
      )}
    </div>
  )
}

export default function AudiencePage() {
  const [overview, setOverview] = useState<AudienceOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [collecting, setCollecting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const today = new Date(Date.now() + 9 * 60 * 60_000).toISOString().slice(0, 10)

  const load = async () => {
    setLoading(true)
    try {
      const res = await api.audience.overview()
      if (res.success) setOverview(res.data)
    } catch {}
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  // 設定した直後に cron を待たずに確かめられるようにする。
  const collectNow = async () => {
    setCollecting(true)
    setMessage(null)
    try {
      const res = await api.audience.collect()
      if (res.success) {
        setMessage(
          res.data.failures.length === 0
            ? `${res.data.recorded}件を取得しました`
            : `${res.data.recorded}件を取得。取得できなかったチャネル: `
              + res.data.failures.map((f) => `${channelLabel(f.channel)}（${f.reason}）`).join('、'),
        )
        await load()
      }
    } catch {
      setMessage('取得に失敗しました')
    }
    setCollecting(false)
  }

  return (
    <div>
      <Header title="名簿規模" />

      <div className="p-6">
        <div className="mb-4 flex items-start justify-between">
          <p className="text-sm text-gray-500">
            メルマガ読者数・LINE友だち数・SNSフォロワー数をまとめて表示します。
            名簿そのものは各チャネルに置いたまま、人数だけを毎日1回集めています。
          </p>
          <button
            onClick={collectNow}
            disabled={collecting}
            className="ml-4 shrink-0 rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {collecting ? '取得中...' : '今すぐ取得'}
          </button>
        </div>

        {message && (
          <div className="mb-4 rounded border border-gray-200 bg-gray-50 px-4 py-2 text-sm text-gray-700">
            {message}
          </div>
        )}

        {loading ? (
          <div className="py-12 text-center text-gray-400">読み込み中...</div>
        ) : !overview || overview.channels.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 p-12 text-center">
            <p className="text-gray-500">まだ数字がありません。</p>
            <p className="mt-2 text-sm text-gray-400">
              「今すぐ取得」を押すか、各ハーネスの URL と API キーを Worker の設定に入れてください。
            </p>
          </div>
        ) : (
          <>
            <div className="mb-6 rounded-lg border border-gray-200 bg-white p-6">
              <div className="text-sm text-gray-500">合計</div>
              <div className="mt-1 text-4xl font-semibold tabular-nums text-gray-900">
                {formatNumber(overview.total)}
              </div>
              <div className="mt-2 flex gap-6 text-sm">
                <Delta value={overview.delta7d} suffix="7日" />
                <Delta value={overview.delta30d} suffix="30日" />
              </div>
              <p className="mt-3 text-xs text-gray-400">
                同じ人が複数チャネルにいる場合は重複して数えています。実人数ではなく接点の総数です。
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {overview.channels.map((channel) => (
                <ChannelCard key={channel.channel} channel={channel} today={today} />
              ))}
            </div>

            {overview.missingChannels.length > 0 && (
              <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
                <span className="font-medium">まだ繋がっていないチャネル:</span>{' '}
                {overview.missingChannels.map(channelLabel).join('、')}
                <p className="mt-1 text-xs text-gray-400">
                  Worker の設定に URL と API キーを入れると、翌朝から自動で数字が入ります。
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
