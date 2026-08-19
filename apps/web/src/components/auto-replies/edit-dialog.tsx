'use client'

import { useState } from 'react'
import { api } from '@/lib/api'
import ImageUploader from '@/components/shared/image-uploader'

export interface AutoReplyDraft {
  id?: string
  keyword: string
  matchType: 'exact' | 'contains'
  responseType: string
  responseContent: string
  templateId: string | null
  lineAccountId: string | null
  isActive: boolean
}

interface Props {
  draft: AutoReplyDraft
  templates: Array<{ id: string; name: string; messageType: string; messageContent: string }>
  onClose: () => void
  onSaved: () => void
}

type ResponseMode = 'silent' | 'template' | 'inline-text' | 'inline-flex' | 'inline-image'

function detectMode(d: AutoReplyDraft): ResponseMode {
  if (d.responseType === 'silent') return 'silent'
  if (d.templateId) return 'template'
  if (d.responseType === 'flex') return 'inline-flex'
  if (d.responseType === 'image') return 'inline-image'
  return 'inline-text'
}

export default function EditDialog({ draft, templates, onClose, onSaved }: Props) {
  const [keyword, setKeyword] = useState(draft.keyword)
  const [matchType, setMatchType] = useState<'exact' | 'contains'>(draft.matchType)
  const [mode, setMode] = useState<ResponseMode>(detectMode(draft))
  const [templateId, setTemplateId] = useState<string | null>(draft.templateId)
  const [responseContent, setResponseContent] = useState(draft.responseContent)
  const [isActive, setIsActive] = useState(draft.isActive)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const flexTemplates = templates.filter((t) => t.messageType === 'flex')
  const textTemplates = templates.filter((t) => t.messageType === 'text')
  const imageTemplates = templates.filter((t) => t.messageType === 'image')

  const handleSave = async () => {
    if (!keyword.trim()) { setError('keyword を入力してください'); return }
    if (mode === 'template' && !templateId) { setError('template を選んでください'); return }
    if ((mode === 'inline-text' || mode === 'inline-flex' || mode === 'inline-image') && !responseContent.trim()) {
      setError('内容を入力してください'); return
    }
    setError('')
    setSaving(true)
    try {
      const body: {
        keyword: string;
        matchType: 'exact' | 'contains';
        responseType: string;
        responseContent: string;
        templateId: string | null;
        lineAccountId: string | null;
        isActive: boolean;
      } = {
        keyword,
        matchType,
        responseType:
          mode === 'silent' ? 'silent'
          : mode === 'inline-flex' ? 'flex'
          : mode === 'inline-image' ? 'image'
          : mode === 'template' ? 'text' /* placeholder, override below if template found */
          : 'text',
        // template mode でも response_content / response_type を残す。template が
        // 削除された (ON DELETE SET NULL) ときの inline fallback として機能する。
        responseContent: mode === 'silent' ? '' : responseContent,
        templateId: mode === 'template' ? templateId : null,
        lineAccountId: draft.lineAccountId,
        isActive,
      }
      if (mode === 'template' && templateId) {
        const tpl = templates.find((t) => t.id === templateId)
        if (tpl) {
          body.responseType = tpl.messageType
          // template が削除された (ON DELETE SET NULL) ときの inline fallback として
          // 現時点の template content をスナップショット保存する。これがないと
          // template 削除後に webhook が空メッセージ送信になる。
          body.responseContent = tpl.messageContent
        }
      }
      if (draft.id) {
        await api.autoReplies.update(draft.id, body)
      } else {
        await api.autoReplies.create(body)
      }
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました')
    }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b">
          <h3 className="text-base font-semibold">{draft.id ? '自動返信ルール 編集' : '新規 自動返信ルール'}</h3>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs text-gray-600 mb-1">keyword</label>
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="例: コスト比較"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">マッチ方法</label>
            <div className="flex gap-2">
              {(['exact', 'contains'] as const).map((mt) => (
                <button
                  key={mt}
                  onClick={() => setMatchType(mt)}
                  className={`px-3 py-1.5 text-xs rounded-md ${matchType === mt ? 'text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                  style={matchType === mt ? { backgroundColor: '#06C755' } : undefined}
                >
                  {mt === 'exact' ? '完全一致' : '包含'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">応答方法</label>
            <div className="flex flex-wrap gap-2">
              {([
                { key: 'silent', label: 'silent (返信なし)' },
                { key: 'template', label: 'テンプレートから' },
                { key: 'inline-text', label: 'テキスト直書き' },
                { key: 'inline-flex', label: 'Flex JSON 直書き' },
                { key: 'inline-image', label: '画像 (image JSON)' },
              ] as const).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setMode(key)}
                  className={`px-3 py-1.5 text-xs rounded-md ${mode === key ? 'text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                  style={mode === key ? { backgroundColor: '#06C755' } : undefined}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {mode === 'template' && (
            <div>
              <label className="block text-xs text-gray-600 mb-1">template</label>
              <select
                value={templateId ?? ''}
                onChange={(e) => setTemplateId(e.target.value || null)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                <option value="">-- 選択 --</option>
                {flexTemplates.length > 0 && (
                  <optgroup label="Flex">
                    {flexTemplates.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </optgroup>
                )}
                {textTemplates.length > 0 && (
                  <optgroup label="テキスト">
                    {textTemplates.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </optgroup>
                )}
                {imageTemplates.length > 0 && (
                  <optgroup label="画像">
                    {imageTemplates.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
              {templates.length === 0 && (
                <p className="text-[11px] text-amber-600 mt-1">
                  テンプレートがありません。<a href="/templates" className="underline">/templates</a> で作成してください。
                </p>
              )}
            </div>
          )}
          {(mode === 'inline-text' || mode === 'inline-flex') && (
            <div>
              <label className="block text-xs text-gray-600 mb-1">
                {mode === 'inline-flex' ? 'Flex JSON' : 'テキスト'}
              </label>
              <textarea
                rows={mode === 'inline-flex' ? 8 : 4}
                value={responseContent}
                onChange={(e) => setResponseContent(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-green-500 resize-y"
              />
            </div>
          )}
          {mode === 'inline-image' && (
            <ImageUploader
              mode="line-image"
              value={(() => {
                try {
                  const parsed = JSON.parse(responseContent) as { originalContentUrl?: string; previewImageUrl?: string }
                  if (parsed.originalContentUrl) {
                    return {
                      mode: 'line-image' as const,
                      originalContentUrl: parsed.originalContentUrl,
                      previewImageUrl: parsed.previewImageUrl ?? parsed.originalContentUrl,
                    }
                  }
                } catch { /* ignore */ }
                return null
              })()}
              onChange={(v) => {
                if (v?.mode === 'line-image') {
                  setResponseContent(JSON.stringify({
                    originalContentUrl: v.originalContentUrl,
                    previewImageUrl: v.previewImageUrl,
                  }))
                } else {
                  setResponseContent('')
                }
              }}
              label="返信画像"
            />
          )}
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
            />
            <span className="text-xs text-gray-600">有効</span>
          </label>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <div className="px-5 py-3 border-t flex gap-2 justify-end">
          <button onClick={onClose} className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-md">キャンセル</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1.5 text-xs font-medium text-white rounded-md disabled:opacity-50"
            style={{ backgroundColor: '#06C755' }}
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
