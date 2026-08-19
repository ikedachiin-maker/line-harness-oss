'use client'

import { useSearchParams } from 'next/navigation'
import ScenarioDetailClient from './scenario-detail-client'

export default function ScenarioDetailPage() {
  const searchParams = useSearchParams()
  const id = searchParams.get('id')
  if (!id) {
    return (
      <div className="p-8 text-center text-sm text-gray-500">
        シナリオ ID が指定されていません
      </div>
    )
  }
  return <ScenarioDetailClient scenarioId={id} />
}
