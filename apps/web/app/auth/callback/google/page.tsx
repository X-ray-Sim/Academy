import { redirect } from 'next/navigation'

export default function GoogleCallbackPage() {
  redirect('/login')
}
