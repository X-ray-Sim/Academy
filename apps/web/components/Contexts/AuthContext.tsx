'use client'

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useAuth as useClerkAuth, useClerk } from '@clerk/nextjs'
import {
  getClerkTokenRefreshDelay,
  getJwtExpirationTime,
  shouldRefreshClerkToken,
} from '@lib/auth/clerkToken'
import { getSessionStatusDuringRefresh } from '@lib/auth/sessionRefresh'
import {
  getAPIUrl,
  getLEARNHOUSE_TOP_DOMAIN_VAL,
} from '@services/config/config'

export interface Session {
  user: any | undefined
  roles?: string[] | undefined
  tokens?: {
    access_token?: string | undefined
    refresh_token?: string | undefined
    expiry?: number | undefined
  } | undefined
}

export type SessionStatus = 'loading' | 'authenticated' | 'unauthenticated'

export interface UseSessionReturn {
  data: Session | null
  status: SessionStatus
  update: (force?: boolean) => Promise<void>
}

export interface SignInOptions {
  redirect?: boolean
  callbackUrl?: string
  orgId?: number
  orgSlug?: string
}

export interface SignInResult {
  ok: boolean
  error: string | null
  url: string | null
  status: number
}

export interface SignOutOptions {
  callbackUrl?: string
  redirect?: boolean
}

interface AuthContextValue {
  session: Session | null
  status: SessionStatus
  accessToken: string | null
  refreshSession: (force?: boolean) => Promise<void>
  signIn: (provider: string, options?: SignInOptions) => Promise<SignInResult | void>
  signOut: (options?: SignOutOptions) => Promise<void>
  getAccessToken: () => Promise<string | null>
}

const AuthContext = createContext<AuthContextValue | null>(null)

const SESSION_CACHE_TTL = 10 * 60 * 1000
const AUTH_BROADCAST_CHANNEL = 'learnhouse_auth_sync'
const LEGACY_AUTH_COOKIES = [
  'LH_access',
  'LH_refresh',
  'LH_session',
  'LH_oauth_state',
  'LH_oauth_orgslug',
  'LH_oauth_org_id',
]

interface SessionCache {
  data: Session
  token: string
  timestamp: number
}

interface SessionProviderProps {
  children: React.ReactNode
  refetchInterval?: number
}

function getRedirectUrl(callbackUrl?: string): string {
  return callbackUrl || '/redirect_from_auth'
}

function clearLegacyAuthCookies(): void {
  if (typeof document === 'undefined') return

  const topDomain = getLEARNHOUSE_TOP_DOMAIN_VAL()
  const expires = 'expires=Thu, 01 Jan 1970 00:00:00 GMT'

  for (const name of LEGACY_AUTH_COOKIES) {
    document.cookie = `${name}=; path=/; ${expires}; SameSite=Lax`
    if (topDomain && topDomain !== 'localhost') {
      document.cookie = `${name}=; path=/; domain=.${topDomain}; ${expires}; SameSite=Lax`
    }
  }
}

async function clearLegacyServerSession(): Promise<void> {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
    })
  } catch {
    // The old cookie API may not exist in every deployment; Clerk remains source of truth.
  }
}

async function fetchBackendSession(token: string): Promise<Session | null> {
  const response = await fetch(`${getAPIUrl()}users/session`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    credentials: 'include',
  })

  if (!response.ok) {
    return null
  }

  const data = await response.json()
  const expiresAt = getJwtExpirationTime(token)
  return {
    user: data.user,
    roles: data.roles,
    tokens: {
      access_token: token,
      refresh_token: undefined,
      expiry: expiresAt ?? undefined,
    },
  }
}

export function SessionProvider({
  children,
  refetchInterval = 600000,
}: SessionProviderProps) {
  const clerk = useClerk()
  const {
    isLoaded,
    isSignedIn,
    getToken,
    signOut: clerkSignOut,
  } = useClerkAuth()
  const [session, setSession] = useState<Session | null>(null)
  const [status, setStatus] = useState<SessionStatus>('loading')
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const sessionCacheRef = useRef<SessionCache | null>(null)
  const refreshPromiseRef = useRef<Promise<void> | null>(null)
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null)

  const resetLocalSession = useCallback(() => {
    setSession(null)
    setAccessToken(null)
    setStatus('unauthenticated')
    sessionCacheRef.current = null
    clearLegacyAuthCookies()
  }, [])

  const refreshSession = useCallback(async (force?: boolean) => {
    if (!isLoaded) {
      setStatus('loading')
      return
    }

    if (!isSignedIn) {
      resetLocalSession()
      return
    }

    if (refreshPromiseRef.current) {
      return refreshPromiseRef.current
    }

    refreshPromiseRef.current = (async () => {
      setStatus(getSessionStatusDuringRefresh)

      try {
        let token = await getToken({ skipCache: Boolean(force) })

        if (!token) {
          resetLocalSession()
          return
        }

        const now = Date.now()
        if (!force && shouldRefreshClerkToken(token, now)) {
          const refreshedToken = await getToken({ skipCache: true })
          if (refreshedToken) {
            token = refreshedToken
          }
        }

        if (
          !force &&
          sessionCacheRef.current &&
          sessionCacheRef.current.token === token &&
          !shouldRefreshClerkToken(token, now) &&
          now - sessionCacheRef.current.timestamp < SESSION_CACHE_TTL
        ) {
          setSession(sessionCacheRef.current.data)
          setAccessToken(token)
          setStatus('authenticated')
          return
        }

        const backendSession = await fetchBackendSession(token)
        if (!backendSession) {
          resetLocalSession()
          return
        }

        setSession(backendSession)
        setAccessToken(token)
        setStatus('authenticated')
        sessionCacheRef.current = {
          data: backendSession,
          token,
          timestamp: now,
        }
      } catch (error) {
        console.error('Clerk session refresh failed:', error)
        resetLocalSession()
      } finally {
        refreshPromiseRef.current = null
      }
    })()

    return refreshPromiseRef.current
  }, [getToken, isLoaded, isSignedIn, resetLocalSession])

  const getAccessToken = useCallback(async (): Promise<string | null> => {
    if (!isLoaded || !isSignedIn) {
      return null
    }

    try {
      let token = await getToken()
      if (shouldRefreshClerkToken(token)) {
        const refreshedToken = await getToken({ skipCache: true })
        if (refreshedToken) {
          token = refreshedToken
        }
      }

      return token
    } catch (error) {
      console.error('Unable to read Clerk token:', error)
      return null
    }
  }, [getToken, isLoaded, isSignedIn])

  useEffect(() => {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      broadcastChannelRef.current = new BroadcastChannel(AUTH_BROADCAST_CHANNEL)
      broadcastChannelRef.current.onmessage = (event) => {
        if (event.data?.type === 'LOGOUT') {
          resetLocalSession()
        }
        if (event.data?.type === 'LOGIN') {
          refreshSession(true)
        }
      }
    }

    return () => {
      broadcastChannelRef.current?.close()
    }
  }, [refreshSession, resetLocalSession])

  useEffect(() => {
    refreshSession()
  }, [refreshSession])

  useEffect(() => {
    if (!refetchInterval || status !== 'authenticated') {
      return undefined
    }

    const interval = window.setInterval(() => {
      refreshSession()
    }, refetchInterval)

    return () => window.clearInterval(interval)
  }, [refetchInterval, refreshSession, status])

  useEffect(() => {
    if (status !== 'authenticated' || !accessToken) {
      return undefined
    }

    const refreshDelay = getClerkTokenRefreshDelay(accessToken)
    if (refreshDelay === null) {
      return undefined
    }

    const timeout = window.setTimeout(() => {
      refreshSession(true)
    }, refreshDelay)

    return () => window.clearTimeout(timeout)
  }, [accessToken, refreshSession, status])

  const handleSignIn = useCallback(async (
    _provider: string,
    options: SignInOptions = {},
  ): Promise<SignInResult | void> => {
    const redirectUrl = getRedirectUrl(options.callbackUrl)

    if (options.redirect === false) {
      return {
        ok: false,
        error: JSON.stringify({
          code: 'CLERK_AUTH_REQUIRED',
          message: 'Credentials and built-in OAuth are disabled. Use Clerk sign-in.',
        }),
        url: null,
        status: 410,
      }
    }

    await clerk.redirectToSignIn({ redirectUrl })
  }, [clerk])

  const handleSignOut = useCallback(async (options: SignOutOptions = {}) => {
    const { callbackUrl = '/', redirect = true } = options

    await clearLegacyServerSession()
    clearLegacyAuthCookies()
    resetLocalSession()

    broadcastChannelRef.current?.postMessage({ type: 'LOGOUT' })

    await clerkSignOut({
      redirectUrl: redirect ? callbackUrl : undefined,
    })
  }, [clerkSignOut, resetLocalSession])

  const contextValue = useMemo<AuthContextValue>(() => ({
    session,
    status,
    accessToken,
    refreshSession,
    signIn: handleSignIn,
    signOut: handleSignOut,
    getAccessToken,
  }), [
    accessToken,
    getAccessToken,
    handleSignIn,
    handleSignOut,
    refreshSession,
    session,
    status,
  ])

  return (
    <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>
  )
}

export function useSession(): UseSessionReturn {
  const context = useContext(AuthContext)

  if (!context) {
    return {
      data: null,
      status: 'unauthenticated',
      update: async () => {},
    }
  }

  return {
    data: context.session,
    status: context.status,
    update: context.refreshSession,
  }
}

export async function signIn(
  _provider: string,
  options?: SignInOptions,
): Promise<SignInResult | void> {
  if (typeof window !== 'undefined') {
    const redirectUrl = getRedirectUrl(options?.callbackUrl)
    const clerk = (window as any).Clerk

    if (clerk?.redirectToSignIn) {
      await clerk.redirectToSignIn({ redirectUrl })
      return
    }

    window.location.href = `/login?redirect_url=${encodeURIComponent(redirectUrl)}`
  }

  return {
    ok: false,
    error: 'Clerk is not loaded',
    url: null,
    status: 503,
  }
}

export async function signOut(options?: SignOutOptions): Promise<void> {
  const { callbackUrl = '/', redirect = true } = options || {}

  await clearLegacyServerSession()
  clearLegacyAuthCookies()

  try {
    const bc = new BroadcastChannel(AUTH_BROADCAST_CHANNEL)
    bc.postMessage({ type: 'LOGOUT' })
    bc.close()
  } catch {
    // BroadcastChannel is optional.
  }

  const clerk = typeof window !== 'undefined' ? (window as any).Clerk : null
  if (clerk?.signOut) {
    await clerk.signOut({ redirectUrl: redirect ? callbackUrl : undefined })
    return
  }

  if (redirect && typeof window !== 'undefined') {
    window.location.href = callbackUrl
  }
}

export function useAuth() {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error('useAuth must be used within a SessionProvider')
  }

  return {
    session: context.session,
    status: context.status,
    accessToken: context.accessToken,
    signIn: context.signIn,
    signOut: context.signOut,
    refreshSession: context.refreshSession,
    getAccessToken: context.getAccessToken,
  }
}

export default SessionProvider
