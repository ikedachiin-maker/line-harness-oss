'use client'

import ImageUploader from './image-uploader'

export interface OgValue {
  ogTitle: string | null
  ogDescription: string | null
  ogImageUrl: string | null
}

export interface OgEditorProps {
  value: OgValue
  onChange: (v: OgValue) => void
  /** auto-generate プレースホルダ表示用。空欄なら自動値が使われる旨を示す。 */
  autoTitle?: string
  autoDescription?: string
  autoImageUrl?: string
  /** account 用 — title slot を非表示にする。account には個別 og:title は不要。 */
  hideTitle?: boolean
}

const TITLE_MAX = 80
const DESC_MAX = 200

export default function OgEditor({
  value,
  onChange,
  autoTitle,
  autoDescription,
  autoImageUrl,
  hideTitle = false,
}: OgEditorProps) {
  const set = <K extends keyof OgValue>(k: K, v: OgValue[K]) =>
    onChange({ ...value, [k]: v })

  return (
    <div className="space-y-3 border border-gray-200 rounded-lg p-4 bg-gray-50">
      <div className="text-sm font-medium text-gray-900">
        リンクプレビュー（OGP）
      </div>
      <div className="text-xs text-gray-500">
        LINE / X / Facebook 等にリンクを貼ったときに表示されるカードの内容。
        空欄なら自動で生成されます。
      </div>

      {!hideTitle && (
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            タイトル
          </label>
          <input
            type="text"
            value={value.ogTitle ?? ''}
            maxLength={TITLE_MAX}
            placeholder={autoTitle ? `自動: ${autoTitle}` : '（自動生成）'}
            onChange={(e) => set('ogTitle', e.target.value || null)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
          <div className="text-xs text-gray-400 mt-1">
            {(value.ogTitle ?? '').length} / {TITLE_MAX}
          </div>
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">
          説明文
        </label>
        <textarea
          value={value.ogDescription ?? ''}
          maxLength={DESC_MAX}
          placeholder={
            autoDescription ? `自動: ${autoDescription}` : '（自動生成）'
          }
          rows={3}
          onChange={(e) => set('ogDescription', e.target.value || null)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
        />
        <div className="text-xs text-gray-400 mt-1">
          {(value.ogDescription ?? '').length} / {DESC_MAX}
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">
          画像
        </label>
        <ImageUploader
          mode="url"
          value={value.ogImageUrl ? { mode: 'url', url: value.ogImageUrl } : null}
          onChange={(v) =>
            set('ogImageUrl', v?.mode === 'url' ? v.url : null)
          }
        />
        {!value.ogImageUrl && autoImageUrl && (
          <div className="text-xs text-gray-400 mt-1">
            自動: {autoImageUrl}
          </div>
        )}
      </div>
    </div>
  )
}
