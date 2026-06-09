'use client'

import React, { useMemo } from 'react'
import { SignIn, SignUp } from '@clerk/nextjs'
import { useSearchParams } from 'next/navigation'

type ClerkAuthMode = 'sign-in' | 'sign-up'

interface ClerkAuthPanelProps {
  mode: ClerkAuthMode
  org?: any
  inviteCode?: string
}

const appearance = {
  elements: {
    rootBox: 'w-full',
    card: 'w-full shadow-none border border-gray-200 rounded-xl',
    headerTitle: 'text-gray-900',
    headerSubtitle: 'text-gray-500',
    formButtonPrimary: 'bg-black hover:bg-gray-800',
    footerActionLink: 'text-gray-900',
  },
}

function safeRedirectUrl(raw: string | null): string | null {
  if (!raw) return null
  if (!raw.startsWith('/')) return null
  if (raw.startsWith('//') || raw.startsWith('/\\')) return null
  if (/[\r\n]/.test(raw)) return null
  return raw
}

export default function ClerkAuthPanel({ mode, org, inviteCode }: ClerkAuthPanelProps) {
  const searchParams = useSearchParams()
  const redirectUrl = useMemo(() => {
    const requestedRedirect =
      safeRedirectUrl(searchParams.get('redirect_url')) ||
      safeRedirectUrl(searchParams.get('redirectUrl')) ||
      safeRedirectUrl(searchParams.get('callbackUrl'))

    if (requestedRedirect) {
      return requestedRedirect
    }

    if (mode === 'sign-up') {
      return inviteCode ? `/signup?inviteCode=${encodeURIComponent(inviteCode)}` : '/signup'
    }

    return '/redirect_from_auth'
  }, [inviteCode, mode, searchParams])

  const signInUrl = mode === 'sign-up'
    ? `/login?redirect_url=${encodeURIComponent(redirectUrl)}`
    : '/login'
  const signUpUrl = mode === 'sign-in'
    ? '/signup'
    : `/signup${inviteCode ? `?inviteCode=${encodeURIComponent(inviteCode)}` : ''}`

  return (
    <div className="m-auto w-full max-w-sm px-6 py-8 sm:py-0">
      {mode === 'sign-in' ? (
        <SignIn
          routing="hash"
          signUpUrl={signUpUrl}
          fallbackRedirectUrl={redirectUrl}
          oauthFlow="redirect"
          appearance={appearance}
        />
      ) : (
        <SignUp
          routing="hash"
          signInUrl={signInUrl}
          fallbackRedirectUrl={redirectUrl}
          oauthFlow="redirect"
          unsafeMetadata={{
            orgId: org?.id,
            orgSlug: org?.slug,
            inviteCode: inviteCode || undefined,
          }}
          appearance={appearance}
        />
      )}
    </div>
  )
}
