'use client'
import { useEffect, useState } from 'react'

const REPO = 'Shudesu/line-harness-oss'
const RELEASES_URL = `https://api.github.com/repos/${REPO}/releases/latest`
const DISMISS_KEY = 'line-harness:update-dismissed-version'
const CACHE_KEY = 'line-harness:update-cache'
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 時間。GitHub anonymous API rate limit (60/hour/IP)
                                     // を圧縮し、長時間タブ運用でも定期再チェックする

export interface ReleaseInfo {
  tag: string
  url: string
}

interface CacheEntry {
  release: ReleaseInfo
  fetchedAt: number
}

function parseSemver(v: string): [number, number, number] {
  const parts = v.replace(/^v/, '').split('.').map((s) => Number.parseInt(s, 10))
  return [
    Number.isFinite(parts[0]) ? parts[0]! : 0,
    Number.isFinite(parts[1]) ? parts[1]! : 0,
    Number.isFinite(parts[2]) ? parts[2]! : 0,
  ]
}

function isNewer(latest: string, current: string): boolean {
  const [lMaj, lMin, lPat] = parseSemver(latest)
  const [cMaj, cMin, cPat] = parseSemver(current)
  if (lMaj !== cMaj) return lMaj > cMaj
  if (lMin !== cMin) return lMin > cMin
  return lPat > cPat
}

function readCache(): CacheEntry | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CacheEntry
    if (
      typeof parsed.fetchedAt !== 'number' ||
      !parsed.release ||
      typeof parsed.release.tag !== 'string'
    ) {
      return null
    }
    if (Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null
    return parsed
  } catch {
    return null
  }
}

function writeCache(release: ReleaseInfo): void {
  if (typeof window === 'undefined') return
  try {
    const entry: CacheEntry = { release, fetchedAt: Date.now() }
    localStorage.setItem(CACHE_KEY, JSON.stringify(entry))
  } catch {
    // QuotaExceededError などは無視
  }
}

export function useUpdateNotification(): {
  release: ReleaseInfo | null
  dismiss: () => void
} {
  const [release, setRelease] = useState<ReleaseInfo | null>(null)

  useEffect(() => {
    let cancelled = false
    const current = process.env.APP_VERSION ?? '0.0.0'

    function applyIfNewer(found: ReleaseInfo): void {
      if (cancelled) return
      const dismissed =
        typeof window !== 'undefined' ? localStorage.getItem(DISMISS_KEY) ?? '' : ''
      if (!isNewer(found.tag, current)) return
      if (found.tag === dismissed) return
      setRelease(found)
    }

    function check(): void {
      const cached = readCache()
      if (cached) {
        applyIfNewer(cached.release)
        return
      }
      fetch(RELEASES_URL, {
        headers: { Accept: 'application/vnd.github+json' },
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (cancelled || !d || typeof d.tag_name !== 'string') return
          const latestTag = d.tag_name as string
          const url =
            typeof d.html_url === 'string'
              ? d.html_url
              : `https://github.com/${REPO}/releases/tag/${latestTag}`
          const found: ReleaseInfo = { tag: latestTag, url }
          writeCache(found)
          applyIfNewer(found)
        })
        .catch(() => {
          // ネットワーク・レートリミット失敗は静かに無視 (通知は best-effort)
        })
    }

    check()
    const interval = window.setInterval(check, CACHE_TTL_MS)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [])

  function dismiss(): void {
    if (release && typeof window !== 'undefined') {
      localStorage.setItem(DISMISS_KEY, release.tag)
      setRelease(null)
    }
  }

  return { release, dismiss }
}
