'use client'

import Link from 'next/link'

export interface InboxRowData {
  friendId: string
  displayName: string | null
  pictureUrl: string | null
  accountId: string
  accountName: string
  lastIncomingAt: string
  lastManualAt: string | null
  lastMachineAt: string | null
  lastIncomingType: string
  lastIncomingContent: string
}

const TYPE_LABELS: Record<string, string> = {
  sticker: 'スタンプ',
  video: '🎥 動画',
  audio: '🎤 音声',
  file: '📄 ファイル',
  location: '📍 位置情報',
}

function formatPreview(type: string, content: string): string {
  if (type !== 'text') return TYPE_LABELS[type] ?? `(${type})`
  return content.length > 80 ? `${content.slice(0, 80)}…` : content
}

function formatElapsed(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 0) return 'たった今'
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'たった今'
  if (min < 60) return `${min}分前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}時間前`
  const day = Math.floor(hr / 24)
  return `${day}日前`
}

function ImageThumb({ raw }: { raw: string }) {
  // webhook 経由の image は {previewImageUrl, originalContentUrl} JSON。
  // 過去 incoming の `[画像]` ラベルは parse 失敗 → label fallback。
  let src: string | undefined
  try {
    const parsed = JSON.parse(raw) as {
      previewImageUrl?: string
      originalContentUrl?: string
    }
    src = parsed.previewImageUrl || parsed.originalContentUrl
  } catch {
    // ignore
  }
  if (!src) return <span className="text-sm text-gray-600">🖼 画像</span>
  return (
    <span className="inline-flex items-center gap-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        loading="lazy"
        className="h-12 w-12 flex-shrink-0 rounded object-cover ring-1 ring-gray-200"
      />
      <span className="text-sm text-gray-500">🖼 画像</span>
    </span>
  )
}

interface Props {
  row: InboxRowData
}

export default function InboxRow({ row }: Props) {
  const machineAfterIncoming =
    row.lastMachineAt &&
    new Date(row.lastMachineAt).getTime() > new Date(row.lastIncomingAt).getTime()

  const ms = Date.now() - new Date(row.lastIncomingAt).getTime()
  const isOverdue = ms >= 60 * 60_000

  return (
    <Link
      href={`/chats?friend=${encodeURIComponent(row.friendId)}&unanswered=1`}
      className="flex items-start gap-3 border-b border-gray-100 px-4 py-3 hover:bg-gray-50"
    >
      {row.pictureUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={row.pictureUrl}
          alt=""
          className="h-10 w-10 flex-shrink-0 rounded-full object-cover"
        />
      ) : (
        <div className="h-10 w-10 flex-shrink-0 rounded-full bg-gray-200" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-gray-900">
            {row.displayName || '(名前なし)'}
          </span>
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
            {row.accountName}
          </span>
          {machineAfterIncoming && (
            <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium text-sky-700">
              auto 返答済
            </span>
          )}
        </div>
        {row.lastIncomingType === 'image' ? (
          <div className="mt-0.5">
            <ImageThumb raw={row.lastIncomingContent} />
          </div>
        ) : (
          <p className="mt-0.5 truncate text-sm text-gray-600">
            {formatPreview(row.lastIncomingType, row.lastIncomingContent)}
          </p>
        )}
      </div>
      <div className="flex-shrink-0 text-right">
        <span
          className={`text-xs tabular-nums ${
            isOverdue ? 'font-semibold text-rose-600' : 'text-gray-500'
          }`}
        >
          {formatElapsed(row.lastIncomingAt)}
        </span>
      </div>
    </Link>
  )
}
