import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/clerk'
import { requireOwnedBusinessId } from '@/lib/auth/business'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  businessSettingsFromRow,
  normalizeBusinessSettingsUpdate,
} from '@/lib/settings/config'

/** GET /api/settings — 현재 사업자의 운영 기본값 */
export async function GET() {
  try {
    const userId = await requireAuth()
    const businessId = await requireOwnedBusinessId(userId)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createAdminClient() as any
    const { data, error } = await supabase
      .from('business_settings')
      .select('*')
      .eq('business_id', businessId)
      .eq('user_id', userId)
      .maybeSingle()

    if (error) {
      return NextResponse.json({ error: `설정 조회 실패: ${error.message}` }, { status: 500 })
    }
    return NextResponse.json({ data: businessSettingsFromRow(businessId, data) })
  } catch (error) {
    if (error instanceof NextResponse) return error
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '설정 조회 오류' },
      { status: 400 }
    )
  }
}

/** PATCH /api/settings — 현재 사업자의 운영 기본값 저장 */
export async function PATCH(request: NextRequest) {
  try {
    const userId = await requireAuth()
    const businessId = await requireOwnedBusinessId(userId)
    const update = normalizeBusinessSettingsUpdate(await request.json())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createAdminClient() as any
    const { data: existing, error: existingError } = await supabase
      .from('business_settings')
      .select('*')
      .eq('business_id', businessId)
      .eq('user_id', userId)
      .maybeSingle()
    if (existingError) {
      return NextResponse.json(
        { error: `기존 설정 조회 실패: ${existingError.message}` },
        { status: 500 }
      )
    }
    const current = businessSettingsFromRow(businessId, existing)

    const dbRow: Record<string, unknown> = {
      business_id: businessId,
      user_id: userId,
      default_commission_rate:
        update.defaultCommissionRate ?? current.defaultCommissionRate,
      default_return_rate:
        update.defaultReturnRate ?? current.defaultReturnRate,
      inventory_alert_threshold_days:
        update.inventoryAlertThresholdDays ?? current.inventoryAlertThresholdDays,
      inventory_notifications_enabled:
        update.inventoryNotificationsEnabled ?? current.inventoryNotificationsEnabled,
      import_column_mappings:
        update.importColumnMappings ?? current.importColumnMappings,
      updated_at: new Date().toISOString(),
    }

    const { data, error } = await supabase
      .from('business_settings')
      .upsert(dbRow, { onConflict: 'business_id' })
      .select('*')
      .single()

    if (error) {
      return NextResponse.json({ error: `설정 저장 실패: ${error.message}` }, { status: 500 })
    }
    return NextResponse.json({ data: businessSettingsFromRow(businessId, data) })
  } catch (error) {
    if (error instanceof NextResponse) return error
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '설정 저장 오류' },
      { status: 400 }
    )
  }
}
