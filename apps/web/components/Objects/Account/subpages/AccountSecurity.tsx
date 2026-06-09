'use client'

import React from 'react'
import { useClerk } from '@clerk/nextjs'
import { LockKeyhole, ShieldCheck } from 'lucide-react'
import { Button } from '@components/ui/button'
import { useTranslation } from 'react-i18next'

function AccountSecurity() {
  const { t } = useTranslation()
  const { openUserProfile } = useClerk()

  return (
    <div className="bg-white rounded-xl nice-shadow">
      <div className="flex flex-col gap-0">
        <div className="flex flex-col bg-gray-50 -space-y-1 px-5 py-3 mx-3 my-3 rounded-md">
          <h1 className="font-bold text-xl text-gray-800">
            {t('user.settings.password.title')}
          </h1>
          <h2 className="text-gray-500 text-md">
            Credentials, passwords, MFA, and connected sign-in methods are managed by Clerk.
          </h2>
        </div>

        <div className="mx-5 mb-5">
          <div className="w-full max-w-2xl mx-auto rounded-lg border border-gray-200 bg-gray-50 p-5">
            <div className="flex items-start gap-3">
              <div className="rounded-md bg-white p-2 text-gray-700 border border-gray-200">
                <ShieldCheck size={20} />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900">Clerk security profile</h3>
                <p className="text-sm text-gray-600 mt-1">
                  Use Clerk to update your password, verification methods, and active sessions.
                </p>
              </div>
            </div>

            <div className="flex justify-end pt-5">
              <Button
                type="button"
                onClick={() => openUserProfile()}
                className="bg-black text-white hover:bg-black/90 gap-2"
              >
                <LockKeyhole size={16} />
                Manage security
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default AccountSecurity
