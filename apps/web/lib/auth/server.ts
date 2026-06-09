import { auth } from '@clerk/nextjs/server'

const BACKEND_URL = (process.env.NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL || 'http://localhost:1338').replace(/\/+$/, '')

export interface Session {
  user: any | undefined
  roles?: string[] | undefined
  tokens?: {
    access_token?: string | undefined
    refresh_token?: string | undefined
    expiry?: number | undefined
  } | undefined
}

export async function getServerSession(): Promise<Session | null> {
  try {
    const { getToken } = await auth()
    const token = await getToken()

    if (!token) {
      return null
    }

    const sessionResponse = await fetch(`${BACKEND_URL}/api/v1/users/session`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
    })

    if (!sessionResponse.ok) {
      return null
    }

    const sessionData = await sessionResponse.json()
    return {
      user: sessionData.user,
      roles: sessionData.roles,
      tokens: {
        access_token: token,
      },
    }
  } catch (error) {
    console.error('[SERVER_SESSION] Error:', error)
    return null
  }
}

export async function getServerAccessToken(): Promise<string | null> {
  try {
    const { getToken } = await auth()
    return await getToken()
  } catch (error) {
    console.error('[SERVER_SESSION] Error getting access token:', error)
    return null
  }
}
