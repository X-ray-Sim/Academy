import '../styles/globals.css'
import { ClerkProvider } from '@clerk/nextjs'
import { getLEARNHOUSE_TOP_DOMAIN_VAL, getLEARNHOUSE_TELEMETRY_DISABLED_VAL } from '@services/config/config'
import Script from 'next/script'
import Providers from '@components/Providers'
import { Wix_Madefor_Text } from 'next/font/google'

const isDevEnv = getLEARNHOUSE_TOP_DOMAIN_VAL() === 'localhost'
const isTelemetryDisabled = getLEARNHOUSE_TELEMETRY_DISABLED_VAL() === 'true'

const wixMadeforText = Wix_Madefor_Text({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-default',
})

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <ClerkProvider>
      <html className={wixMadeforText.variable} lang="en" suppressHydrationWarning>
        <head>
          {/* eslint-disable-next-line @next/next/no-sync-scripts */}
          <script src="/runtime-config.js" />
          {/* eslint-disable-next-line @next/next/no-sync-scripts */}
          <script src="/embed-bg.js" />
        </head>
        <body suppressHydrationWarning>
          {
              isDevEnv ? '' : isTelemetryDisabled ? '' :
                              <Script
                                  data-website-id="a1af6d7a-9286-4a1f-8385-ddad2a29fcbb"
                                  src="/umami/script.js"
                              />
          }
          <Providers>
            <main className="animate-fade-in">
              {children}
            </main>
          </Providers>
        </body>
      </html>
    </ClerkProvider>
  )
}
