'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Header from '@/components/layout/header'
import EventForm from '@/components/events/event-form'
import { useAccount } from '@/contexts/account-context'

function EditEventInner() {
  const params = useSearchParams()
  const id = params.get('id')
  const { selectedAccountId } = useAccount()
  if (!id) {
    return <div className="p-4 text-red-700">id クエリが必要です</div>
  }
  if (!selectedAccountId) {
    return (
      <>
        <Header title="イベント編集" />
        <div className="p-4 text-gray-500">アカウントを選択してください。</div>
      </>
    )
  }
  return (
    <>
      <Header title="イベント編集" />
      <EventForm accountId={selectedAccountId} eventId={id} />
    </>
  )
}

export default function EditEventPage() {
  return (
    <Suspense fallback={<div className="p-4 text-gray-500">読み込み中...</div>}>
      <EditEventInner />
    </Suspense>
  )
}
