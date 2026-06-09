'use client'

import React from 'react'
import { Button } from '@components/ui/button'
import { ShieldCheck, ExternalLink } from 'lucide-react'
import { useTranslation } from 'react-i18next'

const CLERK_DASHBOARD_URL = process.env.NEXT_PUBLIC_CLERK_DASHBOARD_URL || 'https://dashboard.clerk.com'

const OrgEditSSO: React.FC = () => {
  const { t } = useTranslation()

  return (
    <div className="sm:mx-10 mx-0 bg-white rounded-xl nice-shadow pt-3">
      <div className="flex flex-col gap-0">
        <div className="flex flex-col bg-gray-50 -space-y-1 px-5 py-3 mx-3 mb-3 rounded-md">
          <h1 className="font-bold text-xl text-gray-800">
            {t('dashboard.organization.settings.pages.sso.title') || 'Single Sign-On'}
          </h1>
          <h2 className="text-gray-500 text-md">
            SSO and social login providers are managed in Clerk.
          </h2>
        </div>

        <div className="px-5 pb-5">
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-5">
            <div className="flex items-start gap-3">
              <div className="rounded-md bg-white p-2 text-gray-700 border border-gray-200">
                <ShieldCheck size={20} />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900">Clerk owns authentication</h3>
                <p className="text-sm text-gray-600 mt-1">
                  Configure SSO, OAuth providers, password policy, MFA, sessions, and allowed domains in the VitaSim Clerk instance.
                </p>
              </div>
            </div>

            <div className="flex justify-end pt-5">
              <Button
                type="button"
                onClick={() => window.open(CLERK_DASHBOARD_URL, '_blank', 'noopener,noreferrer')}
                className="bg-black text-white hover:bg-black/90 gap-2"
              >
                Open Clerk
                <ExternalLink size={16} />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default OrgEditSSO
