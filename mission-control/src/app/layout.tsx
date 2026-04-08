import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'clawstack — Mission Control',
  description: 'OpenClaw + AI Stack Operations Dashboard',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
