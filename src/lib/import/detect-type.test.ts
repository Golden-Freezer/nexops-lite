import { describe, expect, it } from 'vitest'
import { detectImportType } from './detect-type'
import { validateStatisticsDateRange } from './parser'

describe('Wing 파일 이름 판정', () => {
  it('매출 성장 광고 보고서를 ad_report로 판정한다', () => {
    expect(
      detectImportType('A01008637_pa_total_campaign_20261116_20261122.xlsx'),
    ).toBe('ad_report')
  })

  it.each([
    ['Statistics-20261116~20261116_(0).xlsx', 'sales'],
    ['inventory_health_sku_info_20261122.xlsx', 'inventory_health'],
    ['A01008637-dailySettlement-20261116-20261122.xlsx', 'ad_billing'],
  ] as const)('%s 파일을 %s로 판정한다', (fileName, expected) => {
    expect(detectImportType(fileName)).toBe(expected)
  })
})

describe('Statistics 날짜 범위 제한', () => {
  it('하루치 파일은 허용한다', () => {
    expect(
      validateStatisticsDateRange('Statistics-20261116~20261116_(0).xlsx'),
    ).toBeNull()
  })

  it('여러 날짜 파일은 사람이 읽을 범위를 반환해 차단할 수 있게 한다', () => {
    expect(
      validateStatisticsDateRange('Statistics-20261116~20261122_(0).xlsx'),
    ).toBe('2026-11-16 ~ 2026-11-22')
  })
})
