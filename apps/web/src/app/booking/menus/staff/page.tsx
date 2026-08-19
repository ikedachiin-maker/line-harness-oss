'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Header from '@/components/layout/header'
import { bookingApi, type BookingMenu, type BookingStaff, type StaffMenuMatrix } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'

// このメニューを各スタッフが提供するか／料金所要を上書きするかの一括編集 UI。
// staff_menus は staff_id × menu_id 主キー。スタッフごとに個別 PUT で書く。
export default function MenuStaffMatrix() {
  const sp = useSearchParams()
  const id = sp.get('menu_id') ?? ''
  const { selectedAccountId } = useAccount()
  const [menu, setMenu] = useState<BookingMenu | null>(null)
  const [staff, setStaff] = useState<BookingStaff[]>([])
  const [rows, setRows] = useState<Record<string, StaffMenuMatrix>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  const load = useCallback(async () => {
    if (!selectedAccountId || !id) return
    setLoading(true)
    setError(null)
    // 前 menu/account の rows が残ったまま fetch 失敗 → 保存すると別 menu の
    // 設定を上書きする事故になる。先にクリア + 失敗時は保存ボタン無効化。
    setMenu(null)
    setStaff([])
    setRows({})
    try {
      const [menusRes, sRes] = await Promise.all([
        bookingApi.listMenus(selectedAccountId),
        bookingApi.listStaff(selectedAccountId),
      ])
      setMenu(menusRes.menus.find((m) => m.id === id) ?? null)
      setStaff(sRes.staff)
      const rowsMap: Record<string, StaffMenuMatrix> = {}
      await Promise.all(
        sRes.staff.map(async (s) => {
          const r = await bookingApi.getStaffMenus(selectedAccountId, s.id)
          const me = r.matrix.find((x) => x.menu_id === id)
          rowsMap[s.id] = me ?? {
            menu_id: id,
            name: '',
            is_offered: 0,
            override_duration_minutes: null,
            override_price: null,
          }
        }),
      )
      setRows(rowsMap)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [id, selectedAccountId])

  useEffect(() => {
    load()
  }, [load])

  function update(staffId: string, patch: Partial<StaffMenuMatrix>) {
    setRows({ ...rows, [staffId]: { ...rows[staffId], ...patch } })
  }

  async function saveAll() {
    if (!selectedAccountId) return
    setSaving(true)
    setError(null)
    try {
      for (const s of staff) {
        const fullMatrix = await bookingApi.getStaffMenus(selectedAccountId, s.id)
        const updated = fullMatrix.matrix.map((row) =>
          row.menu_id === id
            ? {
                menu_id: row.menu_id,
                is_offered: Boolean(rows[s.id].is_offered),
                override_duration_minutes: rows[s.id].override_duration_minutes,
                override_price: rows[s.id].override_price,
              }
            : {
                menu_id: row.menu_id,
                is_offered: Boolean(row.is_offered),
                override_duration_minutes: row.override_duration_minutes,
                override_price: row.override_price,
              },
        )
        await bookingApi.putStaffMenus(selectedAccountId, s.id, updated)
      }
      setSavedAt(Date.now())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <Header
        title="メニュー × スタッフ"
        description={
          menu
            ? `「${menu.name}」を提供するスタッフ・上書き設定`
            : 'このメニューを提供できるスタッフ・上書き料金/所要分'
        }
        action={
          <button
            onClick={saveAll}
            // error がある間も無効化: 失敗時に古い rows が残る可能性があるので
            // 「保存して再取得」のショートサーキットを防ぎ、ユーザーが再読み込みする導線へ。
            disabled={saving || !selectedAccountId || loading || Boolean(error)}
            className="px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50"
            style={{ backgroundColor: '#06C755' }}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        }
      />

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}
      {savedAt && Date.now() - savedAt < 3000 && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm">
          保存しました
        </div>
      )}

      {!selectedAccountId ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center text-sm text-gray-500">
          サイドバーでアカウントを選択してください
        </div>
      ) : loading ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center text-sm text-gray-500">
          読み込み中…
        </div>
      ) : staff.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center text-sm text-gray-500">
          先にスタッフを登録してください
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          {menu && (
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 text-xs text-gray-600">
              基本: {menu.duration_minutes}分 / ¥{menu.base_price.toLocaleString()}
              {menu.buffer_after_minutes > 0 && <span className="ml-2">後バッファ {menu.buffer_after_minutes}分</span>}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">スタッフ</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">提供する</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">所要分（上書き）</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">料金（上書き）</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {staff.map((s) => {
                  const row = rows[s.id]
                  if (!row) return null
                  const offered = Boolean(row.is_offered)
                  return (
                    <tr key={s.id} className={offered ? '' : 'opacity-60'}>
                      <td className="px-4 py-3 text-sm">
                        <div className="flex items-center gap-2">
                          {s.profile_image_url ? (
                            <img src={s.profile_image_url} alt="" className="w-8 h-8 rounded-full object-cover" />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-gray-400 text-xs">
                              {s.display_name.slice(0, 1)}
                            </div>
                          )}
                          <div>
                            <div className="font-medium">{s.display_name}</div>
                            {s.is_designation_optional ? (
                              <div className="text-xs text-purple-600">指名なし枠</div>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={offered}
                          onChange={(e) => update(s.id, { is_offered: e.target.checked ? 1 : 0 })}
                          className="w-4 h-4"
                        />
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <input
                          type="number"
                          value={row.override_duration_minutes ?? ''}
                          onChange={(e) =>
                            update(s.id, {
                              override_duration_minutes: e.target.value === '' ? null : Number(e.target.value),
                            })
                          }
                          disabled={!offered}
                          placeholder={menu ? `${menu.duration_minutes}` : '-'}
                          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-24 tabular-nums focus:outline-none focus:ring-2 focus:ring-green-500 disabled:bg-gray-50 disabled:text-gray-400"
                        />
                        <span className="ml-1 text-xs text-gray-400">分</span>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span className="text-xs text-gray-400 mr-1">¥</span>
                        <input
                          type="number"
                          value={row.override_price ?? ''}
                          onChange={(e) =>
                            update(s.id, {
                              override_price: e.target.value === '' ? null : Number(e.target.value),
                            })
                          }
                          disabled={!offered}
                          placeholder={menu ? menu.base_price.toString() : '-'}
                          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-28 tabular-nums focus:outline-none focus:ring-2 focus:ring-green-500 disabled:bg-gray-50 disabled:text-gray-400"
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
