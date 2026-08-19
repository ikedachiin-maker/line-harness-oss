'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'

const fmt = new Intl.NumberFormat('ja-JP')

interface Stats {
  totalFollowing: number
  uniquePeople: number
  friendDups: number
}

export default function SummaryBar() {
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    api.duplicates.stats().then((res) => {
      if (res.success) {
        setStats({
          totalFollowing: res.data.totalFollowing,
          uniquePeople: res.data.uniquePeople,
          friendDups: res.data.friendDups,
        })
      }
    })
  }, [])

  if (!stats) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 rounded-lg bg-white shadow-sm ring-1 ring-gray-200" />
        ))}
      </div>
    )
  }

  const dupRate =
    stats.totalFollowing > 0 ? (stats.friendDups / stats.totalFollowing) * 100 : 0

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <Card label="友だち総数" value={fmt.format(stats.totalFollowing)} />
      <Card label="ユニーク人数" value={fmt.format(stats.uniquePeople)} />
      {/* friendDups は行ベースの「余分な行数」(SUM(row_cnt - 1))。
          1人が3アカウントに居れば +2 とカウントされる。 */}
      <Card label="余分な行数" value={fmt.format(stats.friendDups)} hint="重複ぶんの行" />
      <Card label="余分率" value={`${dupRate.toFixed(1)}%`} hint="総行数のうち余分" />
    </div>
  )
}

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-white p-4 shadow-sm ring-1 ring-gray-200">
      <div className="text-xs font-medium text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-gray-900">{value}</div>
      {hint ? <div className="mt-1 text-xs text-gray-400">{hint}</div> : null}
    </div>
  )
}
