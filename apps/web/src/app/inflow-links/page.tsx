'use client'

import { Fragment, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { api, fetchApi } from '@/lib/api'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'
import type { EntryRoute, TrafficPool, Scenario, Tag } from '@line-crm/shared'
import EditRouteModal from './_components/edit-route-modal'

interface MessageTemplate {
  id: string
  name: string
  messageType: string
  messageContent: string
}

interface TrackedLinkRow {
  id: string
  name: string
  scenarioId: string | null
  isActive: boolean
}

interface RefRouteStats {
  refCode: string
  /** entry_routes に登録された name。未登録なら null。 */
  name: string | null
  friendCount: number
  clickCount: number
  latestAt: string | null
}

interface RefSummaryData {
  routes: RefRouteStats[]
  totalFriends: number
  friendsWithRef: number
  friendsWithoutRef: number
}

interface RefFriend {
  id: string
  displayName: string
  trackedAt: string | null
}

interface RefDetail {
  refCode: string
  name: string
  friends: RefFriend[]
}

const WORKER_BASE = process.env.NEXT_PUBLIC_API_URL ?? ''

export default function InflowLinksPage() {
  const { selectedAccountId } = useAccount()
  const [routes, setRoutes] = useState<EntryRoute[]>([])
  const [pools, setPools] = useState<TrafficPool[]>([])
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [trackedLinks, setTrackedLinks] = useState<TrackedLinkRow[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [summary, setSummary] = useState<RefSummaryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // editing state:
  //   - null       — modal closed
  //   - 'new'      — blank "create" modal
  //   - EntryRoute — edit existing registered route
  //   - { register: refCode } — "register an unregistered ref" — opens create
  //     modal with refCode pre-locked so the prior inflow stats stay attached.
  const [editing, setEditing] = useState<
    EntryRoute | 'new' | { register: string } | null
  >(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  // Expanded-row state for showing friends acquired through a given ref.
  // Mirrors the legacy /affiliates page UX — click row → load via
  // /api/analytics/ref/:refCode → render friend list inline.
  const [expandedRef, setExpandedRef] = useState<string | null>(null)
  const [refDetail, setRefDetail] = useState<RefDetail | null>(null)
  const [refDetailLoading, setRefDetailLoading] = useState(false)
  // poolMembers[poolId] = lineAccountId のセット。pool_accounts を真実として
  // 「この pool が選択中アカウントに配信するか」を判定するために使う。
  // pool.activeAccountId はレガシーシングル所属。マルチアカ pool では不十分。
  const [poolMembers, setPoolMembers] = useState<Record<string, Set<string>>>({})

  const load = async () => {
    setLoading(true)
    setError('')
    // ref-summary は selectedAccountId を渡すと「そのアカで実流入があった
    // ref_code のみ」に絞れる。pool_id NULL のリンクが多い現状ではアカ別の
    // pool 紐付け判定よりも、こちらの実流入ベースの方が運用実態に合う。
    const summaryQuery = selectedAccountId ? `?lineAccountId=${selectedAccountId}` : ''
    const [r, p, s, t, tagRes, sum, tl] = await Promise.all([
      api.entryRoutes.list(),
      api.pools.list(),
      api.scenarios.list(),
      api.messageTemplates.list(),
      api.tags.list().catch(() => ({ success: false, data: [] as Tag[] })),
      fetchApi<{ success: boolean; data: RefSummaryData }>(
        `/api/analytics/ref-summary${summaryQuery}`,
      ).catch(() => ({ success: false, data: null })),
      api.trackedLinks.list().catch(() => ({ success: false, data: null })),
    ])
    if (r.success) setRoutes(r.data)
    else setError('リファラルリンクの取得に失敗しました')
    if (p.success) setPools(p.data)
    if (s.success) setScenarios(s.data)
    if (t.success) setTemplates(t.data)
    if (tagRes.success) setTags(tagRes.data)
    if ('success' in sum && sum.success && sum.data) setSummary(sum.data)
    if (tl.success && tl.data) {
      setTrackedLinks(
        tl.data.map((row) => ({
          id: row.id,
          name: row.name,
          scenarioId: row.scenarioId,
          isActive: row.isActive,
        })),
      )
    }

    // Load pool→accounts mapping after we know the pool list. Done in a 2nd
    // round-trip so the table can render with summary stats immediately; the
    // filter just doesn't apply the pool-membership rule until this resolves
    // (zero-inflow rows still pass through friendCount > 0 path).
    if (p.success) {
      const entries = await Promise.all(
        p.data.map(async (pool) => {
          const res = await api.pools.accounts.list(pool.id)
          const ids = res.success
            ? new Set(res.data.filter((a) => a.isActive).map((a) => a.lineAccountId))
            : new Set<string>()
          return [pool.id, ids] as const
        }),
      )
      setPoolMembers(Object.fromEntries(entries))
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
    // サイドバー側でアカウントを切り替えたら、開きっぱなしの「ref 詳細」も
    // 持ち越さない (アカ A の友だちリストがアカ B の同じ ref 行に残ってしまう
    // クロスアカウントの情報漏れ防止)。stale-response guard だけでは閉じる側を
    // 担保できないので明示的に reset する。
    setExpandedRef(null)
    setRefDetail(null)
    setRefDetailLoading(false)
  }, [selectedAccountId])

  const onCopy = async (refCode: string, id: string) => {
    const url = `${WORKER_BASE}/r/${refCode}`
    try {
      await navigator.clipboard.writeText(url)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 1200)
    } catch {
      // silent
    }
  }

  // Toggle the expandable friend list for a row. Loads on first expand,
  // collapses on second click, swaps detail when expanding a different row.
  // Uses /api/analytics/ref/:refCode (the same API the legacy /affiliates
  // page used) so registered + unregistered refs both work.
  //
  // Race-condition guard: an operator who clicks row A then quickly clicks
  // row B can have request A resolve after B. Without a stale-check, the
  // late A response would overwrite B's detail. We capture the refCode at
  // request time and bail out of state updates when it no longer matches
  // the currently-expanded row.
  const toggleExpand = async (refCode: string) => {
    if (expandedRef === refCode) {
      setExpandedRef(null)
      setRefDetail(null)
      setRefDetailLoading(false)
      return
    }
    setExpandedRef(refCode)
    setRefDetail(null)
    setRefDetailLoading(true)
    const requestedFor = refCode
    const accountAtRequest = selectedAccountId
    const query = accountAtRequest ? `?lineAccountId=${accountAtRequest}` : ''
    const res = await fetchApi<{ success: boolean; data: RefDetail }>(
      `/api/analytics/ref/${encodeURIComponent(refCode)}${query}`,
    ).catch(() => ({ success: false, data: null }))
    // Skip stale updates: only commit if we are still looking at the same
    // ref AND the sidebar account hasn't changed since the request started.
    setExpandedRef((current) => {
      if (current !== requestedFor || accountAtRequest !== selectedAccountId) return current
      if ('success' in res && res.success && res.data) setRefDetail(res.data)
      setRefDetailLoading(false)
      return current
    })
  }

  // Index summary stats by ref_code for cheap lookup per row.
  const statsByRef = new Map<string, RefRouteStats>()
  summary?.routes.forEach((r) => statsByRef.set(r.refCode, r))

  // Merge entry_routes (CRUD 対象), tracked_links (modern path), と
  // summary.routes (実流入のあった refs)。優先順位 = worker の applyRefAttribution
  // と同じ: entry_routes → tracked_links → orphan。
  //
  // tracked_links は entry_routes と別テーブルで管理されている。Worker は両方を
  // フォールバック検索するので tracked_links 登録済み ref も「設定済み」扱いに
  // すべき (Pool は仕様上持たないため "—" 表示)。これがないと「(未登録)」と
  // 表示されるが裏では tracked_links のシナリオが発火している、という UI の嘘
  // になる。
  type Row = {
    source: 'entry_route' | 'tracked_link' | 'orphan'
    /** entry_routes に登録があれば id。tracked_link / orphan は null。 */
    entryRouteId: string | null
    refCode: string
    name: string
    poolId: string | null
    tagId: string | null
    scenarioId: string | null
    /** entry_route のみ意味を持つ (並走/上書き)。他は null。 */
    runAccountFriendAddScenarios: boolean | null
    stats: RefRouteStats | undefined
  }
  const rowsByRef = new Map<string, Row>()
  // 「inactive entry_route を譲るべき相手」の refCode 集合。entry_routes と
  // tracked_links の両方に同じ refCode があった場合、worker の
  // getEntryRouteByRefCode は is_active=1 のみ拾うので、inactive な entry_route
  // は applyRefAttribution で通過されず tracked_links にフォールバックされる。
  // 判定軸は「active tracked_link が存在するか」だけ。実流入 (statsByRef) の
  // 有無に依存させると、最初のクリック前は衝突判定が空回りして UI が嘘の
  // entry_route データを見せてしまう (worker は初回クリックでもう tracked_link
  // を使う)。
  const activeTrackedLinkRefCodes = new Set(
    trackedLinks.filter((tl) => tl.isActive).map((tl) => tl.id),
  )
  for (const r of routes) {
    // Inactive entry_route + active tracked_link が同 refCode に共存する場合、
    // 実際に発火するのは tracked_link。停止中 entry_route の Pool/scenario を
    // 表示すると「設定されてるのに違う挙動」の謎が生まれるのでこのケースだけ
    // 譲る。tracked_link が無ければ inactive でも従来通り表示する。
    if (!r.isActive && activeTrackedLinkRefCodes.has(r.refCode)) continue
    rowsByRef.set(r.refCode, {
      source: 'entry_route',
      entryRouteId: r.id,
      refCode: r.refCode,
      name: r.name,
      poolId: r.poolId,
      tagId: r.tagId,
      scenarioId: r.scenarioId,
      runAccountFriendAddScenarios: r.runAccountFriendAddScenarios,
      stats: statsByRef.get(r.refCode),
    })
  }
  for (const tl of trackedLinks) {
    if (rowsByRef.has(tl.id)) continue // entry_routes が優先
    // /inflow-links は「友だち獲得経路」のページ。tracked_links は /t/:id クリック
    // 計測用にも大量に作られるので、実際に友だちの ref_code に焼かれたもの
    // (= summary に出現するもの) のみ表示する。それ以外は無関係なノイズ。
    if (!statsByRef.has(tl.id)) continue
    // worker の applyRefAttribution は isActive=false の tracked_link を skip する
    // ので UI も合わせて非表示。これがないと「Tracked Link 登録済み」緑バッジ +
    // シナリオ名が出ているのにシナリオが流れない、という嘘になる。inactive で
    // 実流入だけある ref は orphan 行 (「未登録」アンバー) として正しく表示される。
    if (!tl.isActive) continue
    rowsByRef.set(tl.id, {
      source: 'tracked_link',
      entryRouteId: null,
      refCode: tl.id,
      name: tl.name,
      poolId: null, // tracked_links は pool を持たない
      tagId: null,
      scenarioId: tl.scenarioId,
      runAccountFriendAddScenarios: null,
      stats: statsByRef.get(tl.id),
    })
  }
  for (const s of summary?.routes ?? []) {
    if (rowsByRef.has(s.refCode)) continue
    rowsByRef.set(s.refCode, {
      source: 'orphan',
      entryRouteId: null,
      refCode: s.refCode,
      name: s.name ?? '(未登録)',
      poolId: null,
      tagId: null,
      scenarioId: null,
      runAccountFriendAddScenarios: null,
      stats: s,
    })
  }

  // Filter by sidebar's selected account.
  //   - 全アカウント表示: entry_routes 全件 + 未登録 ref 全件
  //   - アカ選択中:
  //       a) 未登録 ref: そのアカで実流入があった分のみ (friendCount > 0)
  //       b) 登録済み行: 実流入 > 0 OR その pool に選択中アカが所属
  //          (pool_id 未設定なら実行時 main フォールバックで main 所属判定)
  //
  // 登録済み行を friendCount > 0 だけで絞ると、作りたての行が一覧から消えて
  // 「保存したのに出てこない」事故になる。一方で「登録済みは全部表示」だと
  // X Harness 1 サイドバー選択中に main プール向けの lp/lp2 が並んで紛らわしい。
  // ルーティングの真実は pool_accounts (worker の getRandomPoolAccount が
  // ここから抽選する) なので、poolMembers を見て所属判定する。
  // マルチアカウント pool でも正しく動く。
  const allRows = Array.from(rowsByRef.values())
  const mainPool = pools.find((p) => p.slug === 'main')
  const poolRoutesToAccount = (poolId: string | null, accountId: string): boolean => {
    const targetPoolId = poolId ?? mainPool?.id
    if (!targetPoolId) return false
    return poolMembers[targetPoolId]?.has(accountId) ?? false
  }
  const accountFilteredRows = selectedAccountId
    ? allRows.filter((r) => {
        if ((r.stats?.friendCount ?? 0) > 0) return true
        if (r.source === 'orphan') return false
        // entry_route / tracked_link は pool 所属判定にフォールバック
        // (tracked_link は poolId=null なので mainPool 所属チェックになる)
        return poolRoutesToAccount(r.poolId, selectedAccountId)
      })
    : allRows

  // Newest "最新追加" first. Routes with no recorded inflow yet sink to the bottom.
  const sortedRows = [...accountFilteredRows].sort((a, b) => {
    const sa = a.stats?.latestAt ?? ''
    const sb = b.stats?.latestAt ?? ''
    if (!sa && !sb) return 0
    if (!sa) return 1
    if (!sb) return -1
    return sb.localeCompare(sa)
  })

  const formatDate = (iso: string | null) => {
    if (!iso) return '—'
    return new Date(iso).toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
  }

  return (
    <div>
      <Header
        title="リファラルリンク"
        description="流入経路ごとの URL を発行し、Pool・起動シナリオ・即時 push を設定します。"
      />

      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-xl p-5 border border-gray-100">
            <p className="text-sm text-gray-500">総友だち数</p>
            <p className="text-3xl font-bold text-gray-900 mt-1">{summary.totalFriends}</p>
          </div>
          <div className="bg-white rounded-xl p-5 border border-gray-100">
            <p className="text-sm text-gray-500">ref 経由</p>
            <p className="text-3xl font-bold text-green-600 mt-1">{summary.friendsWithRef}</p>
          </div>
          <div className="bg-white rounded-xl p-5 border border-gray-100">
            <p className="text-sm text-gray-500">ref 不明</p>
            <p className="text-3xl font-bold text-gray-400 mt-1">{summary.friendsWithoutRef}</p>
          </div>
          <div className="bg-white rounded-xl p-5 border border-gray-100">
            <p className="text-sm text-gray-500">リンク数</p>
            <p className="text-3xl font-bold text-blue-600 mt-1">{routes.length}</p>
          </div>
        </div>
      )}

      <div className="flex justify-between items-center mb-4">
        <span className="text-sm text-gray-500">
          {sortedRows.length} リンク
          {selectedAccountId && allRows.length !== sortedRows.length
            ? `（全 ${allRows.length} 件中、選択中アカ）`
            : ''}
        </span>
        <button
          onClick={() => setEditing('new')}
          className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm hover:bg-blue-700"
        >
          + 新規リンク
        </button>
      </div>

      {error && (
        <div className="p-3 rounded bg-red-50 border border-red-200 text-red-700 text-sm mb-4">
          {error}
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">
          読み込み中...
        </div>
      ) : sortedRows.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">
          {selectedAccountId
            ? '選択中のアカウントに紐づくリファラルリンクはありません。'
            : 'リファラルリンクがありません。「+ 新規リンク」から作成してください。'}
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
          <table className="w-full min-w-[1080px]">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  名前
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  ref コード
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  送り先 Pool
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  起動シナリオ
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  自動付与タグ
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  モード
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                  友だち数
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                  クリック数
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  最新追加
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  URL
                </th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {sortedRows.map((r) => {
                const pool = pools.find((p) => p.id === r.poolId)
                const sc = scenarios.find((s) => s.id === r.scenarioId)
                const tag = tags.find((t) => t.id === r.tagId)
                const editTarget =
                  r.source === 'entry_route'
                    ? routes.find((e) => e.id === r.entryRouteId) ?? null
                    : null
                const isExpanded = expandedRef === r.refCode
                return (
                  <FragmentRow
                    key={r.refCode}
                    isExpanded={isExpanded}
                    onToggle={() => toggleExpand(r.refCode)}
                    refDetailLoading={refDetailLoading}
                    refDetail={refDetail}
                    refCode={r.refCode}
                  >
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">
                      {r.source === 'entry_route' && r.entryRouteId ? (
                        <Link
                          href={`/inflow-links/detail?id=${r.entryRouteId}`}
                          className="text-blue-600 hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {r.name}
                        </Link>
                      ) : r.source === 'tracked_link' ? (
                        <span className="text-gray-700">
                          {r.name}
                          <span
                            className="ml-2 text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5"
                            title="tracked_links 登録済み — クリック計測 + シナリオ起動が設定されています。Pool 振り分けは持ちません。"
                          >
                            Tracked Link
                          </span>
                        </span>
                      ) : (
                        <span className="text-gray-700">
                          {r.name}
                          <span
                            className="ml-2 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5"
                            title="entry_routes / tracked_links いずれにも未登録 — X Harness など外部システムが発行した ref。流入実績のみ集計。"
                          >
                            未登録
                          </span>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm font-mono text-blue-600 break-all">
                      {r.refCode}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {pool ? (
                        pool.name
                      ) : r.source === 'tracked_link' ? (
                        <span
                          className="text-gray-400"
                          title="tracked_links は Pool 振り分けを持ちません (グローバルデフォルトに従う)。"
                        >
                          —
                        </span>
                      ) : (
                        <span
                          className="text-gray-400"
                          title="DB に pool_id 未設定。実行時は URL クエリ ?pool= で振り分けられている可能性あり。"
                        >
                          未設定
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">{sc?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {tag ? (
                        <span
                          className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                          style={{
                            backgroundColor: `${tag.color}22`,
                            color: tag.color,
                          }}
                        >
                          {tag.name}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {r.source === 'entry_route'
                        ? r.runAccountFriendAddScenarios
                          ? '並走'
                          : '上書き'
                        : r.source === 'tracked_link'
                          ? // tracked_links は account-level friend_add scenarios を
                            // 抑制する仕組みを持たない (runAccountFriendAddScenarios
                            // フラグは entry_routes 専用)。worker 上は常に並走挙動。
                            '並走'
                          : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-semibold text-gray-900">
                      {r.stats?.friendCount ?? 0}
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-gray-600">
                      {r.stats?.clickCount ?? 0}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {formatDate(r.stats?.latestAt ?? null)}
                    </td>
                    <td className="px-4 py-3 text-sm" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => onCopy(r.refCode, r.refCode)}
                        className="text-xs text-blue-500 hover:text-blue-700"
                      >
                        {copiedId === r.refCode ? 'コピー済' : 'コピー'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      {editTarget ? (
                        <button
                          onClick={() => setEditing(editTarget)}
                          className="text-xs text-gray-600 hover:underline"
                        >
                          編集
                        </button>
                      ) : r.source === 'tracked_link' ? (
                        // tracked_links は別管理 (Web app に編集 UI 未提供)。
                        // entry_routes への "昇格登録" は worker 優先順位的に
                        // tracked_link を上書きすることになり混乱の元なので、
                        // ここではアクション非表示にして tracked_links 側の
                        // 編集導線 (MCP / API) に委ねる。
                        <span className="text-xs text-gray-400">—</span>
                      ) : (
                        <button
                          onClick={() => setEditing({ register: r.refCode })}
                          className="text-xs text-blue-600 hover:underline"
                          title="未登録 ref を entry_routes に登録します。流入実績はそのまま引き継がれます。"
                        >
                          登録
                        </button>
                      )}
                    </td>
                  </FragmentRow>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <EditRouteModal
          route={
            editing === 'new' || (typeof editing === 'object' && 'register' in editing)
              ? null
              : editing
          }
          initialRefCode={
            typeof editing === 'object' && editing !== null && 'register' in editing
              ? editing.register
              : undefined
          }
          pools={pools}
          scenarios={scenarios}
          templates={templates}
          tags={tags}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            load()
          }}
        />
      )}
    </div>
  )
}

/**
 * Expandable row wrapper. Renders the main `<tr>` plus an optional second
 * `<tr>` underneath it with the friend list for this ref. Whole-row click
 * toggles expansion; nested clickable cells use `stopPropagation` so the
 * 名前 link / コピー / 編集 buttons don't accidentally trigger expand.
 */
function FragmentRow({
  isExpanded,
  onToggle,
  refDetailLoading,
  refDetail,
  refCode,
  children,
}: {
  isExpanded: boolean
  onToggle: () => void
  refDetailLoading: boolean
  refDetail: RefDetail | null
  refCode: string
  children: ReactNode
}) {
  const friends = isExpanded && refDetail?.refCode === refCode ? refDetail.friends : null
  return (
    <Fragment>
      <tr className="hover:bg-gray-50 cursor-pointer" onClick={onToggle}>
        {children}
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={11} className="px-6 py-4 bg-gray-50 border-t border-gray-100">
            {refDetailLoading ? (
              <p className="text-sm text-gray-400">読み込み中…</p>
            ) : !friends ? (
              <p className="text-sm text-gray-400">読み込めませんでした</p>
            ) : friends.length === 0 ? (
              <p className="text-sm text-gray-400">この ref から追加した友だちはまだいません</p>
            ) : (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-3">
                  この ref から追加した友だち ({friends.length}人)
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {friends.map((f) => (
                    <Link
                      key={f.id}
                      href={`/chats?friend=${f.id}`}
                      className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border border-gray-100 hover:border-blue-300"
                    >
                      <span className="text-sm text-gray-800 font-medium truncate">
                        {f.displayName}
                      </span>
                      <span className="text-xs text-gray-400 ml-2 shrink-0">
                        {f.trackedAt
                          ? new Date(f.trackedAt).toLocaleDateString('ja-JP', {
                              year: 'numeric',
                              month: '2-digit',
                              day: '2-digit',
                            })
                          : '—'}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </td>
        </tr>
      )}
    </Fragment>
  )
}
