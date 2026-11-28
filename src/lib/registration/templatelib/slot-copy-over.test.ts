/**
 * 넘친 필수 칸(over, 적용 K14)을 지우지 않아도 되는 근거 — 전 템플릿의 필수 글 칸에 상한 1.5배 글을 넣어도 그려지고 글이 섹션 밖으로 나가지 않는다. 계산값이고 렌더 아님. LLM·DB 없음.
 */

import { describe, expect, it } from 'vitest'
import { renderTemplate } from './engine'
import { TEMPLATES } from './library'
import { mockSlots } from './mock'
import { sampleContext } from './sample'
import { copySlotsOf } from './slot-copy'

const WORDS = '가나다라 마바사 아자차카 타파하 가나다 라마바사 아자차 카타파하 가나다라 마바사 아자차카'
/** 공백을 뺀 글자 수가 chars인 글 — 띄어쓰기가 있어 줄이 나뉜다 */
function textOf(chars: number): string {
  let count = 0
  let out = ''
  for (const letter of WORDS) {
    if (letter !== ' ') {
      if (count === chars) break
      count += 1
    }
    out += letter
  }
  return out.trim()
}

describe('상한 1.5배 글', () => {
  it('전 템플릿 필수 글 칸 — 그려지고 글이 섹션 밖으로 나가지 않는다(첫 화면 칸은 over가 아니라 뺀다)', () => {
    let fields = 0
    for (const template of TEMPLATES) {
      const base = mockSlots(template)
      expect(renderTemplate(template, base, sampleContext()), template.id).not.toBeNull()
      for (const slot of copySlotsOf(template)) {
        if (slot.list || slot.tags || !slot.required || slot.strictLines || slot.maxChars === undefined || slot.choices) continue
        fields += 1
        const out = renderTemplate(template, { ...base, [slot.name]: textOf(Math.ceil(slot.maxChars * 1.5)) }, sampleContext())
        expect(out, `${template.id}.${slot.name}`).not.toBeNull()
        for (const element of out!.elements as Array<{ type?: string; transform?: { y?: number; height?: number } }>) {
          if (element.type !== 'text') continue
          const bottom = (element.transform?.y ?? 0) + (element.transform?.height ?? 0)
          expect(bottom, `${template.id}.${slot.name}`).toBeLessThanOrEqual(out!.height + 1)
        }
      }
    }
    expect(fields).toBeGreaterThan(400)
  })
})
