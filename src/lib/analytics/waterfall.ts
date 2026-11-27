/**
 * 워터폴 차트 base/delta 변환 (Phase 6) — 순수 함수
 * recharts 스택 트릭: base Bar는 투명, delta Bar가 보이는 막대
 */

export interface WaterfallItem {
  name: string
  value: number
  kind: 'start' | 'minus' | 'total'
}

export interface WaterfallSegment extends WaterfallItem {
  base: number
  delta: number
}

/**
 * - start: base=0, delta=value (누계=value)
 * - minus: 직전 누계에서 value만큼 내려가는 부유 막대 (base=누계−value, delta=value)
 * - total: base=0, delta=value(저장값 사용 — 반올림 차이는 무시), 누계를 저장값으로 리셋
 */
export function toWaterfallSegments(items: WaterfallItem[]): WaterfallSegment[] {
  let cum = 0
  return items.map((item) => {
    if (item.kind === 'start') {
      cum = item.value
      return { ...item, base: 0, delta: item.value }
    }
    if (item.kind === 'minus') {
      cum -= item.value
      return { ...item, base: cum, delta: item.value }
    }
    // total: 저장값을 그대로 표시하고 누계를 리셋
    cum = item.value
    return { ...item, base: 0, delta: item.value }
  })
}
