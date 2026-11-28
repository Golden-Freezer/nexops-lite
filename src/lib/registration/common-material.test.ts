/**
 * 흔한 소재(J38 — 오너 11-10 05:18 "ABS 같은 건 장점이 아니니 마지막 스펙 제외하고 상세페이지 설명에는 표기하지 않는 것이 좋다")
 * — 낱말 찾기·섞인 값 나누기·K 칸 카피 입력 거르기, 그리고 D 사실 블록·K 칸 입력·칸 검사·정보 칸 타일·상품 정보 표가 이 규칙을 따르는지. LLM 0
 */

import { describe, expect, it } from 'vitest'
import { getPdpTestProduct } from './__fixtures__/pdp-products'
import { copyInputWithoutCommonMaterial, mentionsCommonMaterial, withoutCommonMaterial } from './common-material'
import type { PdpSpecSheet } from './pdp-state'
import { productInfoRows } from './product-info-rows'
import { buildSpecFactsBlock, COMMON_MATERIAL_RULE, specFactLines } from './spec-facts'
import { factTiles } from './templatelib/info-cells'
import { copyInputWithoutOrigin } from './templatelib/origin-text'
import { checkCopyValues, dropsText } from './templatelib/slot-copy'
import { factsOf } from './templatelib/selection-facts'

const P05 = getPdpTestProduct('P05').specSheet as PdpSpecSheet
const P06 = getPdpTestProduct('P06').specSheet as PdpSpecSheet

describe('mentionsCommonMaterial', () => {
  it('ABS·PP·PE·PVC·플라스틱·합성수지를 잡는다', () => {
    for (const text of ['ABS 손잡이로 가벼워요', '본체는 PP', 'PE 필름 포장', 'PVC 코팅', '플라스틱 모라는 점도 확인해 주세요', '튼튼한 합성 수지', 'ABS소재 핸들']) {
      expect(mentionsCommonMaterial(text), text).toBe(true)
    }
  })

  it('근거 있는 차별 소재와 한정어가 붙은 값, 다른 말 속 영문은 잡지 않는다', () => {
    for (const text of ['스테인리스 304 본체', '식품 등급 실리콘', '식품 등급 PP 용기', 'PP(BPA 프리) 뚜껑', '식품용 플라스틱 통', 'APPLE 호환', 'PS4 거치대', '복근 abs 운동', '방수 소재', '']) {
      expect(mentionsCommonMaterial(text), text).toBe(false)
    }
  })
})

describe('withoutCommonMaterial', () => {
  it('섞인 값에서 흔한 소재 조각만 빼고, 없으면 그대로', () => {
    expect(withoutCommonMaterial('돈모(멧돼지털)·플라스틱')).toBe('돈모(멧돼지털)')
    expect(withoutCommonMaterial('ABS+스테인리스+실리콘')).toBe('스테인리스·실리콘')
    expect(withoutCommonMaterial('ABS')).toBe('')
    expect(withoutCommonMaterial('핸들 소재 ABS')).toBe('')
    expect(withoutCommonMaterial('스테인리스 304, 실리콘')).toBe('스테인리스 304, 실리콘')
    expect(withoutCommonMaterial('식품 등급 PP')).toBe('식품 등급 PP')
  })

  it('K 칸 카피 입력 — 사실은 조각만, 장점 후보는 흔한 소재를 말하면 뺀다', () => {
    expect(copyInputWithoutCommonMaterial({ facts: ['돈모(멧돼지털)·플라스틱', '핸들 소재 ABS', '형태 플랫 타입'], usps: ['ABS 손잡이라 튼튼', '접어서 휴대'] })).toEqual({
      facts: ['돈모(멧돼지털)', '형태 플랫 타입'],
      usps: ['접어서 휴대'],
    })
  })
})

describe('D 원문 카피 — 상품 사실 블록', () => {
  it('P05: 소재는 돈모만, 핸들 소재 ABS 줄은 없고 규칙 줄이 붙는다', () => {
    const lines = specFactLines(P05)
    expect(lines).toContain('- 소재: 돈모(멧돼지털)')
    expect(lines.join('\n')).not.toMatch(/ABS|플라스틱/)
    expect(lines).toContain('- 형태: 플랫 타입')
    const block = buildSpecFactsBlock(P05, { recorded: true })
    expect(block).toContain(COMMON_MATERIAL_RULE)
    expect(block.replace(COMMON_MATERIAL_RULE, '')).not.toMatch(/ABS 손잡이|- 핸들 소재/)
  })

  it('P06: ABS만 빠지고 스테인리스·실리콘은 남는다', () => {
    expect(specFactLines(P06)).toContain('- 소재: 스테인리스·실리콘')
  })

  it('흔한 소재가 없는 잡은 사실 줄·블록이 그대로다(규칙 줄 없음)', () => {
    const spec = { material: '스테인리스 304·식품 등급 실리콘', size: '10cm', extraSpecs: [{ key: '용량', value: '350ml' }] } as PdpSpecSheet
    expect(specFactLines(spec)).toEqual(['- 소재: 스테인리스 304·식품 등급 실리콘', '- 크기: 10cm', '- 용량: 350ml'])
    expect(buildSpecFactsBlock(spec, { recorded: true })).not.toContain(COMMON_MATERIAL_RULE)
  })
})

describe('K 칸 글', () => {
  it('칸 카피 사실·장점 후보에서 빠지고, 사실 예산(factsOf)은 그대로 센다', () => {
    const facts = factsOf(P05).map((fact) => fact.text)
    expect(facts).toContain('핸들 소재 ABS')
    expect(facts).toContain('돈모(멧돼지털)·플라스틱')
    const input = copyInputWithoutOrigin({ facts, usps: ['ABS 핸들로 가볍다', '접이식 휴대'] }, P05.origin)
    expect(input.facts).not.toContain('핸들 소재 ABS')
    expect(input.facts).toContain('돈모(멧돼지털)')
    expect(input.usps).toEqual(['접이식 휴대'])
  })

  it('칸 검사 — 흔한 소재를 쓴 칸은 material(고치기 → 남으면 지움), 차별 소재는 문제 없음', () => {
    const slots = [{ name: 'desc', required: false, facts: 1, maxChars: 40 }]
    expect(checkCopyValues(slots, { desc: '핸들은 ABS 소재예요' }, P05)).toEqual([{ slot: 'desc', kind: 'material', detail: '핸들은 ABS 소재예요' }])
    expect(dropsText('material')).toBe(true)
    expect(checkCopyValues(slots, { desc: '스테인리스 304로 녹슬지 않아요' }, P05).filter((p) => p.kind === 'material')).toEqual([])
    expect(checkCopyValues(slots, { desc: '식품 등급 실리콘이라 안심' }, P05).filter((p) => p.kind === 'material')).toEqual([])
  })

  it('맨 아래 상품 정보 표와 그 요약 칸(정보 칸 사실 타일)은 그대로다 — 스펙 요약이라 소재를 그대로 싣는다(통합 결정 4)', () => {
    expect(productInfoRows(P05).find((row) => row.label === '소재')?.value).toBe('돈모(멧돼지털)·플라스틱')
    expect(factTiles(P05).find((tile) => tile.icon === 'material')?.value).toBe('돈모(멧돼지털)·플라스틱')
    const plasticOnly = { ...P05, material: 'ABS' } as PdpSpecSheet
    expect(factTiles(plasticOnly).find((tile) => tile.icon === 'material')?.value).toBe('ABS')
  })
})
