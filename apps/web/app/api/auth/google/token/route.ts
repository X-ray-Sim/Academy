import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json(
    {
      code: 'CLERK_AUTH_REQUIRED',
      message: 'Google OAuth token exchange is managed by Clerk for this project.',
    },
    { status: 410 },
  )
}
