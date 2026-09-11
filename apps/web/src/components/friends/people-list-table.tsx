'use client'

import Link from 'next/link'
import type { PersonListItem } from '@/lib/api'

/**
 * LINE 友だちとメルマガ読者を1つの表に並べる。
 *
 * 友だち管理の「すべて / メルマガ」表示で使う。「LINE」だけのときは従来の
 * FriendListTable (タグ・対応マーク・チャット導線つき) をそのまま使う。
 * こちらはチャネル横断で共通に出せる列だけ: チャネル / 名前 / 連絡先 / 名簿 / 登録日。
 *
 * メルマガ読者の行はクリック先が無い (line-harness からメールは送らない。
 * 送るのは UTAGE)。LINE 友だちの行は従来どおりチャットへ飛ぶ。
 */
interface Props {
  people: PersonListItem[]
}

const CHANNEL_BADGE: Record<PersonListItem['channel'], { label: string; className: string }> = {
  line: { label: 'LINE', className: 'bg-green-100 text-green-800' },
  mail: { label: 'メルマガ', className: 'bg-amber-100 text-amber-800' },
}

function formatDate(iso: string): string {
  const d = new Date(iso.replace(' ', 'T'))
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10)
  return d.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

export default function PeopleListTable({ people }: Props) {
  if (people.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center text-sm text-gray-500">
        該当する人がいません
      </div>
    )
  }
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 text-xs text-gray-500">
          <tr>
            <th className="px-4 py-2 text-left font-medium w-24">チャネル</th>
            <th className="px-4 py-2 text-left font-medium">名前</th>
            <th className="px-4 py-2 text-left font-medium">連絡先</th>
            <th className="px-4 py-2 text-left font-medium">名簿</th>
            <th className="px-4 py-2 text-left font-medium w-28">登録日</th>
          </tr>
        </thead>
        <tbody>
          {people.map((p) => {
            const badge = CHANNEL_BADGE[p.channel]
            const name = p.displayName || (p.channel === 'mail' ? '(名前なし)' : '(表示名なし)')
            const row = (
              <>
                <td className="px-4 py-3">
                  <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${badge.className}`}>{badge.label}</span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {p.pictureUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.pictureUrl} alt="" className="w-8 h-8 rounded-full object-cover" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-gray-200" />
                    )}
                    <span className="text-gray-900">{name}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-600">{p.email ?? '—'}</td>
                <td className="px-4 py-3 text-gray-600">{p.sourceLabel ?? (p.channel === 'line' ? 'LINE 友だち' : '—')}</td>
                <td className="px-4 py-3 text-gray-500">{formatDate(p.joinedAt)}</td>
              </>
            )
            return p.channel === 'line' ? (
              <tr key={`${p.channel}-${p.id}`} className="border-t border-gray-100 hover:bg-gray-50">
                <td colSpan={5} className="p-0">
                  <Link href={`/chats?friendId=${p.id}`} className="table w-full">
                    <span className="table-row">{row}</span>
                  </Link>
                </td>
              </tr>
            ) : (
              <tr key={`${p.channel}-${p.id}`} className="border-t border-gray-100">{row}</tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
