'use client'

import { useState } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { api } from '@/lib/api'
import { countryFlag } from '@/lib/country-flag'

interface AccountItem {
  id: string
  name: string
  displayName?: string
  country: string | null
}

interface Props {
  accounts: AccountItem[]
  onClose: () => void
  onSaved: () => void
}

function SortableRow({ account }: { account: AccountItem }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: account.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 bg-white border border-gray-200 rounded-lg p-3 cursor-grab"
      {...attributes}
      {...listeners}
    >
      <span className="text-gray-400 text-lg">⋮⋮</span>
      {countryFlag(account.country) && (
        <span className="text-lg">{countryFlag(account.country)}</span>
      )}
      <span className="text-sm font-medium">{account.displayName || account.name}</span>
    </div>
  )
}

export default function ReorderMode({ accounts, onClose, onSaved }: Props) {
  const [items, setItems] = useState<AccountItem[]>(accounts)
  const [saving, setSaving] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    setItems((current) => {
      const oldIndex = current.findIndex((x) => x.id === active.id)
      const newIndex = current.findIndex((x) => x.id === over.id)
      return arrayMove(current, oldIndex, newIndex)
    })
  }

  const handleSave = async () => {
    setSaving(true)
    const ordered = items.map((a, idx) => ({ id: a.id, displayOrder: idx }))
    const res = await api.lineAccounts.updateOrder(ordered)
    setSaving(false)
    if (res.success) {
      onSaved()
      onClose()
    } else {
      alert('保存失敗: ' + (res.error || 'unknown'))
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-5 max-h-[80vh] overflow-y-auto">
        <h2 className="text-sm font-bold mb-4">並び替えモード</h2>
        <p className="text-xs text-gray-500 mb-4">ドラッグで順序変更。サイドバーの並びにも反映されます。</p>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {items.map((a) => <SortableRow key={a.id} account={a} />)}
            </div>
          </SortableContext>
        </DndContext>
        <div className="flex gap-2 mt-5 justify-end">
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-xs">
            キャンセル
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1.5 rounded-lg text-xs text-white disabled:opacity-50"
            style={{ backgroundColor: '#06C755' }}
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
