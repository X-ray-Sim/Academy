import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json(
    {
      code: 'CLERK_AUTH_REQUIRED',
      message: 'Platform token exchange is disabled. Use Clerk authentication.',
    },
    { status: 410 },
  )
}
