'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * 管理画面のログイン。メールアドレス + パスワード。
 *
 * 資格情報はブラウザに保存しない。サーバが HttpOnly の Cookie を出し、
 * JS から読めるのは CSRF トークンだけ。
 *
 * 初期パスワードのまま入ってきた場合は、そのまま変更フォームに切り替える。
 * サーバ側も変更するまで他の API を通さないので、ここで逃がしても意味が無い。
 */
export default function LoginPage() {
  const [mode, setMode] = useState<'login' | 'change-password'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const apiUrl = process.env.NEXT_PUBLIC_API_URL

  const cacheProfile = (data: { name?: string; role?: string }, csrfToken?: string) => {
    try {
      if (data.name) localStorage.setItem('lh_staff_name', data.name)
      if (data.role) localStorage.setItem('lh_staff_role', data.role)
      if (csrfToken) localStorage.setItem('lh_csrf', csrfToken)
    } catch {
      // 保存できなくてもログイン自体は成立する (Cookie 側が本体)。
    }
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      if (!apiUrl) {
        setError('NEXT_PUBLIC_API_URL is not set in build env')
        return
      }

      const res = await fetch(`${apiUrl}/api/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      const data = await res.json().catch(() => null)

      if (res.ok && data?.success) {
        try { localStorage.removeItem('lh_api_key') } catch { /* 旧方式の残骸 */ }
        cacheProfile(data.data ?? {}, data.csrfToken)

        // 初期パスワードのままなら、先に変えてもらう。
        if (data.data?.mustChangePassword) {
          setMode('change-password')
          setNewPassword('')
          setConfirmPassword('')
          return
        }
        router.push('/')
        return
      }

      setError(data?.error || 'ログインに失敗しました')
    } catch {
      setError('接続に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (newPassword !== confirmPassword) {
      setError('新しいパスワードが一致しません')
      return
    }

    setLoading(true)
    try {
      let csrf = ''
      try { csrf = localStorage.getItem('lh_csrf') ?? '' } catch { /* 無くても送る */ }

      const res = await fetch(`${apiUrl}/api/auth/password`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
        },
        body: JSON.stringify({ currentPassword: password, newPassword }),
      })

      const data = await res.json().catch(() => null)

      if (res.ok && data?.success) {
        // 変更すると既存のセッションは全部切れる。この端末用の新しい CSRF を
        // 受け取っているので入れ直す。
        if (data.csrfToken) {
          try { localStorage.setItem('lh_csrf', data.csrfToken) } catch { /* best-effort */ }
        }
        router.push('/')
        return
      }

      setError(data?.error || 'パスワードを変更できませんでした')
    } catch {
      setError('接続に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  const inputClass =
    'w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent'

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#06C755' }}>
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-sm">
        <div className="text-center mb-6">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold text-lg mx-auto mb-3"
            style={{ backgroundColor: '#06C755' }}
          >
            H
          </div>
          <h1 className="text-xl font-bold text-gray-900">L Harness</h1>
          <p className="text-sm text-gray-500 mt-1">
            {mode === 'login' ? '管理画面にログイン' : 'パスワードを変更してください'}
          </p>
        </div>

        {mode === 'login' ? (
          <form onSubmit={handleLogin}>
            <div className="mb-4">
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                メールアドレス
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className={inputClass}
                autoFocus
              />
            </div>

            <div className="mb-4">
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                パスワード
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="パスワードを入力"
                className={inputClass}
              />
            </div>

            {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

            <button
              type="submit"
              disabled={loading || !email || !password}
              className="w-full py-3 text-white font-medium rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: '#06C755' }}
            >
              {loading ? 'ログイン中...' : 'ログイン'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleChangePassword}>
            <p className="text-sm text-gray-600 mb-4">
              初期パスワードのままです。変更するまで他の画面は開けません。
            </p>

            <div className="mb-4">
              <label htmlFor="new-password" className="block text-sm font-medium text-gray-700 mb-1">
                新しいパスワード
              </label>
              <input
                id="new-password"
                name="new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="12文字以上"
                className={inputClass}
                autoFocus
              />
              <p className="text-xs text-gray-400 mt-1">
                12文字以上。記号は不要です。長いほうが強くなります
              </p>
            </div>

            <div className="mb-4">
              <label htmlFor="confirm-password" className="block text-sm font-medium text-gray-700 mb-1">
                もう一度入力
              </label>
              <input
                id="confirm-password"
                name="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={inputClass}
              />
            </div>

            {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

            <button
              type="submit"
              disabled={loading || !newPassword || !confirmPassword}
              className="w-full py-3 text-white font-medium rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: '#06C755' }}
            >
              {loading ? '変更中...' : 'パスワードを変更して続ける'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
