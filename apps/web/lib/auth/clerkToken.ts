export const TOKEN_REFRESH_SKEW_MS = 60_000

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')

  return atob(padded)
}

export function getJwtExpirationTime(token: string | null | undefined): number | null {
  if (!token) return null

  const [, payload] = token.split('.')
  if (!payload) return null

  try {
    const claims = JSON.parse(decodeBase64Url(payload))
    return typeof claims.exp === 'number' ? claims.exp * 1000 : null
  } catch {
    return null
  }
}

export function shouldRefreshClerkToken(
  token: string | null | undefined,
  nowMs: number = Date.now(),
  skewMs: number = TOKEN_REFRESH_SKEW_MS,
): boolean {
  const expiresAt = getJwtExpirationTime(token)
  if (!expiresAt) return true

  return expiresAt - nowMs <= skewMs
}
