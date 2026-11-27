/**
 * 광고 원장 금액의 의미를 한 곳에서 정규화한다.
 *
 * - spent_amount: 실제 소진액(공급가, VAT 별도)
 * - billable_amount: 조정이 반영된 청구 가능액(공급가, VAT 별도)
 * - vat_amount: 부가가치세
 *
 * 손익에는 조정 전 소진액이 아니라 청구 가능액을 우선 사용한다. 단, 과거
 * 수기 행처럼 청구 가능액이 null인 경우에만 소진액으로 폴백한다. 0은
 * "미제공"이 아니라 실제 값일 수 있으므로 null과 구분한다.
 */

export interface AdAmountSource {
  spent_amount?: number | string | null
  billable_amount?: number | string | null
  vat_amount?: number | string | null
}

export interface ResolvedAdAmounts {
  spentExVat: number
  billableExVat: number | null
  vat: number
  accountingBase: number
  accountingTotal: number
  accountingSource: 'billable' | 'spent'
}

function finiteNumber(value: number | string | null | undefined): number | null {
  if (value == null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function resolveAdAmounts(source: AdAmountSource): ResolvedAdAmounts {
  const spentExVat = finiteNumber(source.spent_amount) ?? 0
  const billableExVat = finiteNumber(source.billable_amount)
  const vat = finiteNumber(source.vat_amount) ?? 0
  const accountingSource = billableExVat === null ? 'spent' : 'billable'
  const accountingBase = billableExVat ?? spentExVat

  return {
    spentExVat,
    billableExVat,
    vat,
    accountingBase,
    accountingTotal: accountingBase + vat,
    accountingSource,
  }
}

export function sumAdAmounts(rows: AdAmountSource[]): ResolvedAdAmounts {
  return rows.reduce<ResolvedAdAmounts>((total, row) => {
    const current = resolveAdAmounts(row)
    return {
      spentExVat: total.spentExVat + current.spentExVat,
      billableExVat:
        total.billableExVat === null && current.billableExVat === null
          ? null
          : (total.billableExVat ?? 0) + (current.billableExVat ?? 0),
      vat: total.vat + current.vat,
      accountingBase: total.accountingBase + current.accountingBase,
      accountingTotal: total.accountingTotal + current.accountingTotal,
      accountingSource:
        total.accountingSource === 'spent' || current.accountingSource === 'spent'
          ? 'spent'
          : 'billable',
    }
  }, {
    spentExVat: 0,
    billableExVat: null,
    vat: 0,
    accountingBase: 0,
    accountingTotal: 0,
    accountingSource: 'billable',
  })
}
