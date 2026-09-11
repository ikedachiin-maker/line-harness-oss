'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Tag } from '@line-crm/shared'
import { api } from '@/lib/api'
import type { FriendListItem, PersonListItem, PeopleChannel } from '@/lib/api'
import Header from '@/components/layout/header'
import FriendListTable from '@/components/friends/friend-list-table'
import PeopleListTable from '@/components/friends/people-list-table'
import CcPromptButton from '@/components/cc-prompt-button'
import { useAccount } from '@/contexts/account-context'

const ccPrompts = [
  {
    title: '友だちのセグメント分析',
    prompt: `友だち一覧のデータを分析してください。
1. タグ別の友だち数を集計
2. アクティブ率の高いセグメントを特定
3. エンゲージメントが低い層への施策を提案
レポート形式で出力してください。`,
  },
  {
    title: 'タグ一括管理',
    prompt: `友だちのタグを一括管理してください。
1. 未タグの友だちを特定
2. 行動履歴に基づいたタグ付け提案
3. 不要タグの整理
作業手順を示してください。`,
  },
]

const PAGE_SIZE = 20

type SortMode = 'recent' | 'oldest'
type ResponseFilter = 'all' | 'unhandled'
// チャネル切替。'line' のときだけ従来の表(タグ・対応マーク・チャット導線)を出す。
// 'all' / 'mail' は横断の表(GET /api/people)。人単位で並べられるのは LINE と
// メルマガだけ(X / Threads は API にフォロワー一覧が無い。人数は「名簿規模」)。
type ChannelFilter = 'all' | PeopleChannel

const CHANNEL_TABS: { value: ChannelFilter; label: string }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'line', label: 'LINE 友だち' },
  { value: 'mail', label: 'メルマガ読者' },
]

export default function FriendsPage() {
  const { selectedAccountId } = useAccount()
  const [friends, setFriends] = useState<FriendListItem[]>([])
  const [people, setPeople] = useState<PersonListItem[]>([])
  const [channel, setChannel] = useState<ChannelFilter>('all')
  const [allTags, setAllTags] = useState<Tag[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [hasNextPage, setHasNextPage] = useState(false)
  const [selectedTagId, setSelectedTagId] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [searchSubmitted, setSearchSubmitted] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('recent')
  const [responseFilter, setResponseFilter] = useState<ResponseFilter>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadTags = useCallback(async () => {
    try {
      const res = await api.tags.list()
      if (res.success) setAllTags(res.data)
    } catch {
      // Non-blocking — tags used for filter
    }
  }, [])

  const loadFriends = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      // 横断表示はチャネル共通の列だけを持つ /api/people を読む。
      // タグ・対応マークは LINE 固有なので、その絞り込みは LINE 表示のときだけ効く。
      if (channel !== 'line') {
        const res = await api.people.list({
          channel,
          offset: (page - 1) * PAGE_SIZE,
          limit: PAGE_SIZE,
          accountId: selectedAccountId || undefined,
          search: searchSubmitted || undefined,
          sort: sortMode,
        })
        if (res.success) {
          setPeople(res.data.items)
          setTotal(res.data.total)
          setHasNextPage(res.data.hasNextPage)
        } else {
          setError(res.error)
        }
        return
      }
      const res = await api.friends.list({
        offset: String((page - 1) * PAGE_SIZE),
        limit: PAGE_SIZE,
        tagId: selectedTagId || undefined,
        accountId: selectedAccountId || undefined,
        search: searchSubmitted || undefined,
        includeChatStatus: true,
        sort: sortMode,
        handled: responseFilter === 'unhandled' ? 'unhandled' : undefined,
      })
      if (res.success) {
        setFriends(res.data.items)
        setTotal(res.data.total)
        setHasNextPage(res.data.hasNextPage)
      } else {
        setError(res.error)
      }
    } catch {
      setError('友だちの読み込みに失敗しました。もう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }, [page, channel, selectedTagId, selectedAccountId, searchSubmitted, sortMode, responseFilter])

  useEffect(() => {
    loadTags()
  }, [loadTags])

  // Reset the URL-style account context to page 1 in a separate effect.
  // For user-driven filter changes (search/sort/handled/tag) we reset
  // page synchronously inside the handlers below — that avoids the
  // double-fetch race where the old `page` request resolves after the
  // new `page=1` request and overwrites the correct page-1 rows.
  useEffect(() => {
    setPage(1)
  }, [selectedAccountId])

  useEffect(() => {
    loadFriends()
  }, [loadFriends])

  // Fan-out helpers: changing a filter also resets pagination synchronously,
  // so React batches both state updates into one re-render and `loadFriends`
  // fires exactly once with the new filter + page=1.
  const updateAndResetPage = (cb: () => void) => {
    cb()
    setPage(1)
  }
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    updateAndResetPage(() => setSearchSubmitted(searchInput.trim()))
  }
  // Clearing the input clears the active search even if the user doesn't
  // press 検索 again. Without this, "search Alice → clear input → change
  // tag" would keep filtering by Alice while the input box looks empty —
  // see codex feedback. Keeping a non-empty input that doesn't match
  // searchSubmitted is fine: the user is mid-edit, hasn't applied yet.
  const handleSearchInputChange = (v: string) => {
    setSearchInput(v)
    if (v.trim() === '' && searchSubmitted !== '') {
      updateAndResetPage(() => setSearchSubmitted(''))
    }
  }
  const handleSortChange = (v: SortMode) => updateAndResetPage(() => setSortMode(v))
  const handleResponseFilterChange = (v: ResponseFilter) => updateAndResetPage(() => setResponseFilter(v))
  const handleTagFilterChange = (v: string) => updateAndResetPage(() => setSelectedTagId(v))
  const handleChannelChange = (v: ChannelFilter) => updateAndResetPage(() => setChannel(v))

  return (
    <div>
      <Header
        title="友だちリスト"
        description="LINE 友だちとメルマガ読者を、ひとつの一覧で確認できます。"
      />

      {/* チャネル切替 — LINE だけのときは従来の表、それ以外は横断の表 */}
      <div className="flex gap-1 mb-4 border-b border-gray-200">
        {CHANNEL_TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => handleChannelChange(t.value)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
              channel === t.value
                ? 'border-green-500 text-green-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Search + sort bar — L-step style */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
        <form onSubmit={handleSearchSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => handleSearchInputChange(e.target.value)}
            placeholder={channel === 'mail' ? '名前かメールアドレスで検索' : '名前で検索'}
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <select
            value={sortMode}
            onChange={(e) => handleSortChange(e.target.value as SortMode)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
          >
            <option value="recent">登録の新しい順</option>
            <option value="oldest">登録の古い順</option>
          </select>
          <button
            type="submit"
            className="px-4 py-2 rounded-lg text-white text-sm font-medium"
            style={{ backgroundColor: '#06C755' }}
          >
            検索
          </button>
        </form>

        {/* Secondary filters — タグ + 対応マーク (LINE 固有なので LINE 表示のときだけ) */}
        <div className="flex flex-wrap items-center gap-3 mt-3 pt-3 border-t border-gray-100">
          {channel === 'line' && (<>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-600 font-medium whitespace-nowrap">タグ:</label>
            <select
              className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
              value={selectedTagId}
              onChange={(e) => handleTagFilterChange(e.target.value)}
            >
              <option value="">すべて</option>
              {allTags.map((tag) => (
                <option key={tag.id} value={tag.id}>{tag.name}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-600 font-medium whitespace-nowrap">対応マーク:</label>
            <select
              className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
              value={responseFilter}
              onChange={(e) => handleResponseFilterChange(e.target.value as ResponseFilter)}
            >
              <option value="all">すべて</option>
              <option value="unhandled">未対応のみ</option>
            </select>
          </div>
          </>)}
          <span className="text-xs text-gray-500 ml-auto">
            {loading ? '読み込み中...' : `${total.toLocaleString('ja-JP')} 件`}
          </span>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="px-4 py-4 border-b border-gray-100 grid grid-cols-[80px_220px_120px_1fr_280px] gap-3 animate-pulse">
              <div className="h-5 bg-gray-100 rounded w-16" />
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-full bg-gray-200" />
                <div className="h-3 bg-gray-200 rounded w-24" />
              </div>
              <div className="h-3 bg-gray-100 rounded w-20" />
              <div className="space-y-2">
                <div className="h-3 bg-gray-100 rounded w-3/4" />
                <div className="h-2 bg-gray-100 rounded w-20" />
              </div>
              <div className="h-5 bg-gray-100 rounded w-32" />
            </div>
          ))}
        </div>
      ) : (
        channel === 'line'
          ? <FriendListTable friends={friends} allTags={allTags} onRefresh={loadFriends} />
          : <PeopleListTable people={people} />
      )}

      {!loading && total > 0 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mt-4">
          <p className="text-sm text-gray-500">
            {((page - 1) * PAGE_SIZE) + 1}〜{Math.min(page * PAGE_SIZE, total)} 件 / 全{total.toLocaleString('ja-JP')}件
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-2 min-h-[44px] text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              前へ
            </button>
            <span className="text-sm text-gray-600 px-1">{page} ページ</span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={!hasNextPage}
              className="px-3 py-2 min-h-[44px] text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              次へ
            </button>
          </div>
        </div>
      )}

      <CcPromptButton prompts={ccPrompts} />
    </div>
  )
}
