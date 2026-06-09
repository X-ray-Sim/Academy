import { NextRequest, NextResponse } from 'next/server'
import { getCookieDomain } from '@services/auth/cookies'

const LEGACY_COOKIE_NAMES = [
  'LH_access',
  'LH_refresh',
  'LH_session',
  'LH_oauth_state',
  'LH_oauth_orgslug',
  'LH_oauth_org_id',
]

function clerkAuthRequired() {
  return NextResponse.json(
    {
      code: 'CLERK_AUTH_REQUIRED',
      message: 'Credentials and built-in OAuth are disabled. Use Clerk authentication.',
    },
    { status: 410 },
  )
}

function clearLegacyAuthCookies(request: NextRequest) {
  const response = NextResponse.json({ ok: true })
  const isSecure = request.nextUrl.protocol === 'https:'
  const domain = getCookieDomain(request)
  const securePart = isSecure ? '; Secure' : ''

  for (const name of LEGACY_COOKIE_NAMES) {
    if (domain) {
      response.headers.append(
        'Set-Cookie',
        `${name}=; Path=/; Domain=${domain}; Max-Age=0; SameSite=Lax${securePart}`,
      )
    }

    response.headers.append(
      'Set-Cookie',
      `${name}=; Path=/; Max-Age=0; SameSite=Lax${securePart}`,
    )
  }

  return response
}

function handleAuthRequest(request: NextRequest) {
  const pathSegments = request.nextUrl.pathname.replace('/api/auth/', '')

  if (pathSegments === 'logout' || pathSegments.endsWith('/logout')) {
    return clearLegacyAuthCookies(request)
  }

  return clerkAuthRequired()
}

export async function GET(request: NextRequest) {
  return handleAuthRequest(request)
}

export async function POST(request: NextRequest) {
  return handleAuthRequest(request)
}

export async function PUT(request: NextRequest) {
  return handleAuthRequest(request)
}

export async function PATCH(request: NextRequest) {
  return handleAuthRequest(request)
}

export async function DELETE(request: NextRequest) {
  return handleAuthRequest(request)
}
