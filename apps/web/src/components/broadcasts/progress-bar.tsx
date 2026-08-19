'use client'

interface ProgressBarProps {
  totalCount: number
  successCount: number
}

export default function ProgressBar({ totalCount, successCount }: ProgressBarProps) {
  const pct = totalCount > 0 ? Math.round((successCount / totalCount) * 100) : 0

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <p className="text-sm font-medium text-gray-700 mb-2">
        送信中... {successCount.toLocaleString('ja-JP')}/{totalCount.toLocaleString('ja-JP')}人 ({pct}%)
      </p>
      <div className="w-full bg-gray-200 rounded-full h-3">
        <div
          className="bg-green-500 h-3 rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
