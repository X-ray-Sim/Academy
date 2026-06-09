export type SessionRefreshStatus = 'loading' | 'authenticated' | 'unauthenticated'

export function getSessionStatusDuringRefresh(
  currentStatus: SessionRefreshStatus,
): SessionRefreshStatus {
  return currentStatus === 'authenticated' ? currentStatus : 'loading'
}
