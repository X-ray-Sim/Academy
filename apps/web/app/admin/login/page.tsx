'use client'

import React from 'react'
import { SignIn } from '@clerk/nextjs'
import { Shield } from 'lucide-react'

export default function AdminLoginPage() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-[#0f0f10]">
      <div className="w-full max-w-sm px-6">
        <div className="flex flex-col items-center mb-8">
          <Shield className="w-10 h-10 text-white/70 mb-3" />
          <h1 className="text-2xl font-bold text-white">VitaSim Admin</h1>
          <p className="text-white/40 text-sm mt-1">Sign in to continue</p>
        </div>

        <SignIn
          routing="hash"
          forceRedirectUrl="/admin"
          fallbackRedirectUrl="/admin"
          signUpUrl="/signup"
          oauthFlow="redirect"
          appearance={{
            elements: {
              rootBox: 'w-full',
              card: 'w-full shadow-none border border-white/10 rounded-xl',
              formButtonPrimary: 'bg-white text-black hover:bg-white/90',
              footerActionLink: 'text-white',
            },
          }}
        />
      </div>
    </div>
  )
}
