'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Tag } from '@line-crm/shared'
import { api } from '@/lib/api'

interface SegmentRule {
  type: 'tag_exists' | 'tag_not_exists' | 'metadata_equals' | 'metadata_not_equals' | 'is_following'
  value: string | boolean | { key: string; value: string }
}

interface SegmentCondition {
  operator: 'AND' | 'OR'
  rules: SegmentRule[]
}

interface SegmentBuilderProps {
  tags: Tag[]
  accountId: string | null
  initialConditions?: SegmentCondition | null
  onApply: (conditions: SegmentCondition) => void
  onCancel: () => void
}

const ruleTypeLabels: Record<SegmentRule['type'], string> = {
  tag_exists: 'タグあり',
  tag_not_exists: 'タグなし',
  metadata_equals: 'メタデータ一致',
  metadata_not_equals: 'メタデータ不一致',
  is_following: 'フォロー中のみ',
}

export default function SegmentBuilder({ tags, accountId, initialConditions, onApply, onCancel }: SegmentBuilderProps) {
  const [operator, setOperator] = useState<'AND' | 'OR'>(initialConditions?.operator ?? 'AND')
  const [rules, setRules] = useState<SegmentRule[]>(initialConditions?.rules ?? [{ type: 'tag_exists', value: '' }])
  const [count, setCount] = useState<number | null>(null)
  const [counting, setCounting] = useState(false)

  const fetchCount = useCallback(async () => {
    const validRules = rules.filter(r => {
      if (r.type === 'is_following') return true
      if (typeof r.value === 'string') return r.value !== ''
      if (typeof r.value === 'object' && r.value !== null) return (r.value as { key: string }).key !== ''
      return false
    })
    if (validRules.length === 0) { setCount(null); return }

    setCounting(true)
    try {
      const res = await api.segments.count({ operator, rules: validRules }, accountId ?? undefined)
      if (res.success) setCount(res.count ?? 0)
    } catch { /* ignore */ }
    finally { setCounting(false) }
  }, [operator, rules, accountId])

  useEffect(() => {
    const timer = setTimeout(fetchCount, 500)
    return () => clearTimeout(timer)
  }, [fetchCount])

  const updateRule = (index: number, updates: Partial<SegmentRule>) => {
    setRules(prev => prev.map((r, i) => i === index ? { ...r, ...updates } as SegmentRule : r))
  }

  const removeRule = (index: number) => {
    setRules(prev => prev.filter((_, i) => i !== index))
  }

  const addRule = () => {
    setRules(prev => [...prev, { type: 'tag_exists', value: '' }])
  }

  return (
    <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700">配信対象を絞り込む</h3>
        <select
          value={operator}
          onChange={(e) => setOperator(e.target.value as 'AND' | 'OR')}
          className="text-xs border border-gray-300 rounded px-2 py-1 bg-white"
        >
          <option value="AND">すべて満たす (AND)</option>
          <option value="OR">いずれか満たす (OR)</option>
        </select>
      </div>

      <div className="space-y-2 mb-3">
        {rules.map((rule, i) => (
          <div key={i} className="flex items-center gap-2 bg-white rounded border border-gray-200 p-2">
            <select
              value={rule.type}
              onChange={(e) => {
                const type = e.target.value as SegmentRule['type']
                const defaultValue = type === 'is_following' ? true
                  : (type === 'metadata_equals' || type === 'metadata_not_equals') ? { key: '', value: '' }
                  : ''
                updateRule(i, { type, value: defaultValue })
              }}
              className="text-xs border border-gray-300 rounded px-2 py-1 bg-white min-w-[120px]"
            >
              {Object.entries(ruleTypeLabels).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>

            {(rule.type === 'tag_exists' || rule.type === 'tag_not_exists') && (
              <select
                value={typeof rule.value === 'string' ? rule.value : ''}
                onChange={(e) => updateRule(i, { value: e.target.value })}
                className="text-xs border border-gray-300 rounded px-2 py-1 bg-white flex-1"
              >
                <option value="">タグを選択...</option>
                {tags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}

            {(rule.type === 'metadata_equals' || rule.type === 'metadata_not_equals') && (
              <>
                <input
                  type="text"
                  placeholder="key"
                  value={typeof rule.value === 'object' && rule.value !== null ? (rule.value as { key: string }).key : ''}
                  onChange={(e) => updateRule(i, { value: { key: e.target.value, value: typeof rule.value === 'object' && rule.value !== null ? (rule.value as { value: string }).value : '' } })}
                  className="text-xs border border-gray-300 rounded px-2 py-1 w-24"
                />
                <input
                  type="text"
                  placeholder="value"
                  value={typeof rule.value === 'object' && rule.value !== null ? (rule.value as { value: string }).value : ''}
                  onChange={(e) => updateRule(i, { value: { key: typeof rule.value === 'object' && rule.value !== null ? (rule.value as { key: string }).key : '', value: e.target.value } })}
                  className="text-xs border border-gray-300 rounded px-2 py-1 w-24"
                />
              </>
            )}

            {rule.type !== 'is_following' && (
              <button onClick={() => removeRule(i)} className="text-red-400 hover:text-red-600 text-xs px-1 shrink-0">×</button>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <button onClick={addRule} className="text-xs text-blue-500 hover:text-blue-700">+ ルール追加</button>
        <span className="text-xs text-gray-500">
          {counting ? '計算中...' : count != null ? `該当: ${count.toLocaleString('ja-JP')}人` : ''}
        </span>
      </div>

      <div className="flex gap-2 mt-3 pt-3 border-t border-gray-200">
        <button
          onClick={() => onApply({ operator, rules })}
          className="px-3 py-1.5 min-h-[44px] text-xs font-medium text-white rounded-md"
          style={{ backgroundColor: '#06C755' }}
        >
          適用
        </button>
        <button onClick={onCancel} className="px-3 py-1.5 min-h-[44px] text-xs font-medium text-gray-600 bg-gray-200 rounded-md">
          キャンセル
        </button>
      </div>
    </div>
  )
}
