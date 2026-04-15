import { NextRequest, NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/api-auth'
import { logger } from '@/lib/logger'
import { getDashboardPreferences, updateDashboardPreferences } from '@/lib/preferences'
import type { AppearancePreference, DensityPreference } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const unauthorized = requireApiAuth(request)

  if (unauthorized) {
    return unauthorized
  }

  const preferences = await getDashboardPreferences()

  return NextResponse.json({
    ok: true,
    preferences,
  })
}

export async function PUT(request: NextRequest) {
  const unauthorized = requireApiAuth(request)

  if (unauthorized) {
    return unauthorized
  }

  try {
    const body = (await request.json()) as {
      appearancePreference?: AppearancePreference
      densityPreference?: DensityPreference
      showCompletedTasks?: boolean
      refreshIntervalSeconds?: number
    }
    const preferences = await updateDashboardPreferences(body)

    return NextResponse.json({
      ok: true,
      preferences,
    })
  } catch (error) {
    logger.warn('Mission Control settings update failed', {
      error: error instanceof Error ? error.message : String(error),
    })

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unable to update settings',
      },
      { status: 400 },
    )
  }
}
