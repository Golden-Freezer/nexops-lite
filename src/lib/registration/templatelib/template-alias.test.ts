/**
 * 템플릿 id 별칭(통합 11-02 23:5x) — 이름이 바뀐 칸을 옛 저장 K 계획(templateRef.id)이 그대로 쓰게 푼다. 근거: capture d9f1c961 섹션 18 → 17
 * (#594 option_gallery.lead-card → lead-bleed로 template-fallback). 목록·전수 린트·선택에는 들지 않는다. LLM·DB 없음.
 */

import { describe, expect, it } from 'vitest'
import { renderTemplate } from './engine'
import { TEMPLATE_ALIASES, TEMPLATES, templateById } from './library'
import { sampleContext, sampleSlots } from './sample'

const ids = new Set(TEMPLATES.map((t) => t.id))

describe('템플릿 id 별칭', () => {
  it('옛 id는 지금 목록에 없고, 가리키는 새 id는 목록에 있으며, 별칭끼리 잇지 않고 섹션이 같다', () => {
    expect(TEMPLATE_ALIASES.size).toBe(24)
    for (const [oldId, newId] of TEMPLATE_ALIASES) {
      expect(ids.has(oldId), oldId).toBe(false)
      expect(ids.has(newId), newId).toBe(true)
      expect(TEMPLATE_ALIASES.has(newId), newId).toBe(false)
      expect(oldId.split('.')[0], oldId).toBe(newId.split('.')[0])
    }
  })

  it('옛 id가 새 템플릿으로 풀린다 — d9f1c961의 option_gallery.lead-card는 lead-bleed', () => {
    for (const [oldId, newId] of TEMPLATE_ALIASES) expect(templateById(oldId), oldId).toBe(templateById(newId))
    expect(templateById('option_gallery.lead-card')?.id).toBe('option_gallery.lead-bleed')
  })

  it('지금 id는 그대로 풀리고(별칭보다 먼저), 모르는 id·객체 속성 이름은 없다', () => {
    for (const t of TEMPLATES) expect(templateById(t.id)).toBe(t)
    expect(templateById('option_gallery.no-such')).toBeUndefined()
    expect(templateById('constructor')).toBeUndefined()
    expect(templateById('')).toBeUndefined()
  })

  it('별칭은 목록에 들지 않는다 — 선택·전수 린트 대상이 아니다', () => {
    expect(TEMPLATES.some((t) => TEMPLATE_ALIASES.has(t.id))).toBe(false)
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length)
  })

  it.each([...TEMPLATE_ALIASES])('%s → %s — 옛 id로 새 템플릿이 그려진다', (oldId) => {
    const t = templateById(oldId)!
    expect(renderTemplate(t, sampleSlots(t, { mode: 'required' }), sampleContext())).not.toBeNull()
  })
})
