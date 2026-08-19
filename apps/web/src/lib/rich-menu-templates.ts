// LINE リッチメニュー の作成テンプレ。areas は元画像ピクセル座標。
// クライアントは選択したテンプレを `templateToAreas()` で AreaInput[] に変換し
// 新規 page の初期 areas として送る。
//
// v1 サポートサイズ: Large (2500x1686) / Compact (2500x843)。

export type RichMenuTemplate = {
  key: string;
  label: string;
  size: 'large' | 'compact';
  description?: string;
  areas: { x: number; y: number; w: number; h: number }[];
};

const LARGE = { width: 2500, height: 1686 };
const COMPACT = { width: 2500, height: 843 };

export const TEMPLATES: RichMenuTemplate[] = [
  {
    key: 'large-2x3',
    label: '2x3 (大画像 6 ボタン)',
    size: 'large',
    description: '2 行 × 3 列の標準レイアウト',
    areas: Array.from({ length: 6 }, (_, i) => ({
      x: (i % 3) * (LARGE.width / 3),
      y: Math.floor(i / 3) * (LARGE.height / 2),
      w: LARGE.width / 3,
      h: LARGE.height / 2,
    })),
  },
  {
    key: 'large-3x1',
    label: '3x1 (横 3 分割)',
    size: 'large',
    description: '横並び 3 ボタン (画像全高)',
    areas: [0, 1, 2].map((i) => ({
      x: i * (LARGE.width / 3),
      y: 0,
      w: LARGE.width / 3,
      h: LARGE.height,
    })),
  },
  {
    key: 'large-2x2',
    label: '2x2',
    size: 'large',
    description: '2 行 × 2 列',
    areas: Array.from({ length: 4 }, (_, i) => ({
      x: (i % 2) * (LARGE.width / 2),
      y: Math.floor(i / 2) * (LARGE.height / 2),
      w: LARGE.width / 2,
      h: LARGE.height / 2,
    })),
  },
  {
    key: 'large-1plus2',
    label: '1+2 (上 1 / 下 2)',
    size: 'large',
    description: '上段に大ボタン 1、下段に 2 ボタン',
    areas: [
      { x: 0, y: 0, w: LARGE.width, h: LARGE.height / 2 },
      { x: 0, y: LARGE.height / 2, w: LARGE.width / 2, h: LARGE.height / 2 },
      { x: LARGE.width / 2, y: LARGE.height / 2, w: LARGE.width / 2, h: LARGE.height / 2 },
    ],
  },
  {
    key: 'large-empty',
    label: '空白 (自由配置)',
    size: 'large',
    description: 'areas なしで開始 (エディタで自由に追加)',
    areas: [],
  },
  {
    key: 'compact-3x1',
    label: 'Compact 3x1',
    size: 'compact',
    description: '低高画像で横 3 分割',
    areas: [0, 1, 2].map((i) => ({
      x: i * (COMPACT.width / 3),
      y: 0,
      w: COMPACT.width / 3,
      h: COMPACT.height,
    })),
  },
  {
    key: 'compact-empty',
    label: 'Compact 空白',
    size: 'compact',
    description: '低高画像で areas なし',
    areas: [],
  },
];

export function templateToAreas(t: RichMenuTemplate) {
  return t.areas.map((a) => ({
    boundsX: Math.round(a.x),
    boundsY: Math.round(a.y),
    boundsWidth: Math.round(a.w),
    boundsHeight: Math.round(a.h),
    actionType: 'message' as const,
    actionData: { text: '' },
  }));
}
