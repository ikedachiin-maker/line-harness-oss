'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

export type Area = {
  id: string
  boundsX: number
  boundsY: number
  boundsWidth: number
  boundsHeight: number
  actionType: 'uri' | 'message' | 'postback' | 'richmenuswitch'
  actionData: Record<string, unknown>
}

const SIZE_DIMS = {
  large: { width: 2500, height: 1686 },
  compact: { width: 2500, height: 843 },
} as const

const SNAP_PX = 4
const MIN_AREA = 20

type DragState =
  | { mode: 'create'; startX: number; startY: number; curX: number; curY: number }
  | {
      mode: 'move'
      areaId: string
      original: Area
      startX: number
      startY: number
    }
  | {
      mode: 'resize'
      areaId: string
      original: Area
      handle: string
      startX: number
      startY: number
    }
  | null

type Props = {
  areas: Area[]
  size: 'large' | 'compact'
  imageUrl: string | null
  selectedAreaId: string | null
  onSelectArea: (id: string | null) => void
  onAddArea: (area: Area) => void
  onUpdateArea: (id: string, patch: Partial<Area>) => void
  onDeleteArea: (id: string) => void
  preview?: boolean
  onPreviewAction?: (area: Area) => void
}

function snap(value: number, others: number[]): number {
  for (const o of others) {
    if (Math.abs(value - o) < SNAP_PX) return o
  }
  return value
}

function isOverlapping(a: Area, others: Area[]): boolean {
  return others.some((b) => {
    if (b.id === a.id) return false
    return !(
      a.boundsX + a.boundsWidth <= b.boundsX ||
      b.boundsX + b.boundsWidth <= a.boundsX ||
      a.boundsY + a.boundsHeight <= b.boundsY ||
      b.boundsY + b.boundsHeight <= a.boundsY
    )
  })
}

export function CanvasEditor({
  areas,
  size,
  imageUrl,
  selectedAreaId,
  onSelectArea,
  onAddArea,
  onUpdateArea,
  onDeleteArea,
  preview = false,
  onPreviewAction,
}: Props) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const dims = SIZE_DIMS[size]
  const [scale, setScale] = useState(0.3)
  const [drag, setDrag] = useState<DragState>(null)

  function toImageCoord(clientX: number, clientY: number) {
    const rect = canvasRef.current!.getBoundingClientRect()
    return {
      x: Math.round((clientX - rect.left) / scale),
      y: Math.round((clientY - rect.top) / scale),
    }
  }

  function clampX(x: number, w: number) {
    return Math.max(0, Math.min(dims.width - w, x))
  }
  function clampY(y: number, h: number) {
    return Math.max(0, Math.min(dims.height - h, y))
  }

  function handleCanvasMouseDown(e: React.MouseEvent) {
    if (preview) return
    if (e.target !== canvasRef.current) return
    const { x, y } = toImageCoord(e.clientX, e.clientY)
    setDrag({ mode: 'create', startX: x, startY: y, curX: x, curY: y })
    onSelectArea(null)
  }

  function handleAreaMouseDown(e: React.MouseEvent, area: Area) {
    e.stopPropagation()
    if (preview) {
      onPreviewAction?.(area)
      return
    }
    onSelectArea(area.id)
    const { x, y } = toImageCoord(e.clientX, e.clientY)
    setDrag({ mode: 'move', areaId: area.id, original: area, startX: x, startY: y })
  }

  function handleHandleMouseDown(e: React.MouseEvent, area: Area, handle: string) {
    e.stopPropagation()
    if (preview) return
    const { x, y } = toImageCoord(e.clientX, e.clientY)
    setDrag({
      mode: 'resize',
      areaId: area.id,
      original: area,
      handle,
      startX: x,
      startY: y,
    })
  }

  // Window 全体に mousemove / mouseup を貼って drag を追跡
  useEffect(() => {
    if (!drag) return
    function onMove(e: MouseEvent) {
      const { x, y } = toImageCoord(e.clientX, e.clientY)
      if (!drag) return
      if (drag.mode === 'create') {
        setDrag({ ...drag, curX: x, curY: y })
        return
      }
      if (drag.mode === 'move') {
        const o = drag.original
        const dx = x - drag.startX
        const dy = y - drag.startY
        const otherXs = areas
          .filter((a) => a.id !== drag.areaId)
          .flatMap((a) => [a.boundsX, a.boundsX + a.boundsWidth])
        const otherYs = areas
          .filter((a) => a.id !== drag.areaId)
          .flatMap((a) => [a.boundsY, a.boundsY + a.boundsHeight])
        const newX = snap(clampX(o.boundsX + dx, o.boundsWidth), otherXs)
        const newY = snap(clampY(o.boundsY + dy, o.boundsHeight), otherYs)
        onUpdateArea(o.id, { boundsX: newX, boundsY: newY })
        return
      }
      if (drag.mode === 'resize') {
        const o = drag.original
        const dx = x - drag.startX
        const dy = y - drag.startY
        let { boundsX, boundsY, boundsWidth, boundsHeight } = o
        if (drag.handle.includes('e')) {
          boundsWidth = Math.max(MIN_AREA, o.boundsWidth + dx)
        }
        if (drag.handle.includes('s')) {
          boundsHeight = Math.max(MIN_AREA, o.boundsHeight + dy)
        }
        if (drag.handle.includes('w')) {
          boundsX = Math.min(o.boundsX + o.boundsWidth - MIN_AREA, o.boundsX + dx)
          boundsWidth = o.boundsX + o.boundsWidth - boundsX
        }
        if (drag.handle.includes('n')) {
          boundsY = Math.min(o.boundsY + o.boundsHeight - MIN_AREA, o.boundsY + dy)
          boundsHeight = o.boundsY + o.boundsHeight - boundsY
        }
        boundsX = clampX(boundsX, boundsWidth)
        boundsY = clampY(boundsY, boundsHeight)
        boundsWidth = Math.min(dims.width - boundsX, boundsWidth)
        boundsHeight = Math.min(dims.height - boundsY, boundsHeight)
        onUpdateArea(o.id, { boundsX, boundsY, boundsWidth, boundsHeight })
        return
      }
    }
    function onUp(e: MouseEvent) {
      if (!drag) return
      if (drag.mode === 'create') {
        const { x, y } = toImageCoord(e.clientX, e.clientY)
        const w = Math.abs(x - drag.startX)
        const h = Math.abs(y - drag.startY)
        if (w >= MIN_AREA && h >= MIN_AREA) {
          // LINE の上限 (1 page あたり area 20 個) を事前にブロック。
          // 上限を超えて追加させると Save Draft / Publish が 400 になる。
          if (areas.length >= 20) {
            alert('1 ページあたり areas は最大 20 個までです (LINE 仕様)。')
          } else {
            onAddArea({
              id: typeof crypto !== 'undefined' && 'randomUUID' in crypto
                ? crypto.randomUUID()
                : `area-${Math.random().toString(36).slice(2, 10)}`,
              boundsX: clampX(Math.min(drag.startX, x), w),
              boundsY: clampY(Math.min(drag.startY, y), h),
              boundsWidth: w,
              boundsHeight: h,
              actionType: 'message',
              actionData: { text: '' },
            })
          }
        }
      }
      setDrag(null)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    // areas / dims / scale を deps に入れると drag 中に再アタッチされて挙動が崩れる。
    // toImageCoord は ref 経由なので OK。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag])

  // キーボード操作
  useEffect(() => {
    if (!selectedAreaId || preview) return
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      // INPUT/TEXTAREA/SELECT に focus がある間は area 操作を無効化
      // (右パネルの action-type / target-page select で矢印キーが奪われる事故防止)
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (target?.isContentEditable) return
      const area = areas.find((a) => a.id === selectedAreaId)
      if (!area) return
      const step = e.shiftKey ? 10 : 1
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        onUpdateArea(area.id, { boundsX: Math.max(0, area.boundsX - step) })
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        onUpdateArea(area.id, {
          boundsX: clampX(area.boundsX + step, area.boundsWidth),
        })
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        onUpdateArea(area.id, { boundsY: Math.max(0, area.boundsY - step) })
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        onUpdateArea(area.id, {
          boundsY: clampY(area.boundsY + step, area.boundsHeight),
        })
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        onDeleteArea(area.id)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onSelectArea(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAreaId, areas, preview])

  // create 中の仮矩形
  const previewRect = useMemo(() => {
    if (drag?.mode !== 'create') return null
    const x = Math.min(drag.startX, drag.curX)
    const y = Math.min(drag.startY, drag.curY)
    const w = Math.abs(drag.curX - drag.startX)
    const h = Math.abs(drag.curY - drag.startY)
    return { x, y, w, h }
  }, [drag])

  return (
    <div className="space-y-2 select-none">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-gray-500 text-xs">ズーム</span>
        {[0.25, 0.3, 0.5, 0.75, 1].map((s) => (
          <button
            key={s}
            onClick={() => setScale(s)}
            className={`px-2 py-0.5 text-xs rounded ${
              Math.abs(scale - s) < 0.01
                ? 'bg-gray-800 text-white'
                : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
            }`}
          >
            {Math.round(s * 100)}%
          </button>
        ))}
        <span className="ml-3 text-xs text-gray-400">
          {dims.width}×{dims.height}
        </span>
        {!preview && (
          <span className="ml-auto text-xs text-gray-400">
            空白でドラッグ → 新規矩形 / 矩形クリックで選択 / 矢印キーで微調整 / Delete で削除
          </span>
        )}
      </div>
      <div
        className="overflow-auto border border-gray-300 bg-gray-100"
        style={{ maxHeight: '70vh' }}
      >
        <div
          ref={canvasRef}
          onMouseDown={handleCanvasMouseDown}
          className="relative bg-white"
          style={{
            width: dims.width * scale,
            height: dims.height * scale,
            cursor: preview ? 'default' : 'crosshair',
          }}
        >
          {imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt=""
              className="absolute inset-0 w-full h-full pointer-events-none object-cover"
            />
          )}
          {areas.map((area) => {
            const overlap = isOverlapping(area, areas)
            const selected = area.id === selectedAreaId
            const borderColor = preview
              ? 'transparent'
              : overlap
                ? '#dc2626'
                : selected
                  ? '#2563eb'
                  : '#3b82f6'
            return (
              <div
                key={area.id}
                onMouseDown={(e) => handleAreaMouseDown(e, area)}
                className="absolute"
                style={{
                  left: area.boundsX * scale,
                  top: area.boundsY * scale,
                  width: area.boundsWidth * scale,
                  height: area.boundsHeight * scale,
                  border: `2px solid ${borderColor}`,
                  background: preview
                    ? 'transparent'
                    : selected
                      ? 'rgba(37,99,235,0.18)'
                      : 'rgba(59,130,246,0.10)',
                  cursor: preview ? 'pointer' : 'move',
                  boxSizing: 'border-box',
                }}
              >
                {!preview && selected &&
                  ['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w'].map((h) => (
                    <div
                      key={h}
                      onMouseDown={(e) => handleHandleMouseDown(e, area, h)}
                      style={{
                        position: 'absolute',
                        width: 8,
                        height: 8,
                        background: '#2563eb',
                        ...handleStyle(h),
                      }}
                    />
                  ))}
              </div>
            )
          })}
          {previewRect && previewRect.w > 0 && previewRect.h > 0 && (
            <div
              className="absolute pointer-events-none"
              style={{
                left: previewRect.x * scale,
                top: previewRect.y * scale,
                width: previewRect.w * scale,
                height: previewRect.h * scale,
                border: '2px dashed #2563eb',
                background: 'rgba(37,99,235,0.10)',
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function handleStyle(h: string): React.CSSProperties {
  const map: Record<string, React.CSSProperties> = {
    nw: { left: -4, top: -4, cursor: 'nw-resize' },
    ne: { right: -4, top: -4, cursor: 'ne-resize' },
    sw: { left: -4, bottom: -4, cursor: 'sw-resize' },
    se: { right: -4, bottom: -4, cursor: 'se-resize' },
    n: { left: '50%', top: -4, marginLeft: -4, cursor: 'n-resize' },
    s: { left: '50%', bottom: -4, marginLeft: -4, cursor: 's-resize' },
    e: { right: -4, top: '50%', marginTop: -4, cursor: 'e-resize' },
    w: { left: -4, top: '50%', marginTop: -4, cursor: 'w-resize' },
  }
  return map[h]
}
