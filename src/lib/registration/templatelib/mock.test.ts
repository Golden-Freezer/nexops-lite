import { describe, expect, it } from 'vitest'
import { imageSlot, templateOf, textSlot } from './engine.fixture'
import { fillMeta } from './fill'
import { TEMPLATES } from './library'
import { buildMockHtml, mockSlots, templateBodyHtml } from './mock'
import { missingSlots } from './slots'

const t = fillMeta(
  templateOf({
    name: '시험 <템플릿>',
    flow: [
      { kind: 'text', slot: 'headline', token: 'H1', gapAfter: 'photoGap' },
      { kind: 'image', slot: 'photo' },
    ],
    slots: { headline: textSlot({ required: true, maxChars: 16, maxLines: 3 }), photo: imageSlot({ required: true, composition: ['in_hand'] }) },
  })
)

describe('mockSlots', () => {
  it('글자 수 상한을 넘지 않는 안내문으로 채운다', () => {
    const headline = mockSlots(t).headline as string
    expect(headline.replace(/\s/g, '').length).toBeLessThanOrEqual(16)
    expect(headline).toContain('제목')
  })

  it('필수 슬롯이 비지 않는다 — 라이브러리 전부', () => {
    for (const template of TEMPLATES) expect(missingSlots(template, mockSlots(template)), template.id).toEqual([])
  })

  it('상품 정보 표는 필수 7행을 순서대로 보여 준다', () => {
    const spec = TEMPLATES.find((x) => x.id === 'spec_table.line-rows')!
    const rows = mockSlots(spec).rows as Array<{ label: string }>
    expect(rows.map((r) => r.label)).toEqual(['상품명', '브랜드', '색상/수량', '사이즈', '소재', '원산지', '사용연령'])
  })
})

describe('templateBodyHtml', () => {
  it('구도를 적은 자리표시 사진을 넣고 외부 사진을 부르지 않는다', () => {
    const html = templateBodyHtml(t)!
    expect(html).toContain('data:image/svg+xml')
    expect(html).toContain(encodeURIComponent('손에 든 컷'))
    // 비율이 viewBox에 제대로 들어간다(3:4 → 600×800)
    expect(html).toContain(encodeURIComponent('viewBox="0 0 600 800"'))
    expect(html).not.toContain('NaN')
    expect(html).not.toMatch(/<img[^>]+src="https?:/)
  })

  it('라이브러리 전부 그려진다', () => {
    for (const template of TEMPLATES) expect(templateBodyHtml(template), template.id).not.toBeNull()
  })
})

describe('buildMockHtml', () => {
  const html = buildMockHtml()

  it('모든 템플릿이 들어간다', () => {
    for (const template of TEMPLATES) expect(html).toContain(`id="${template.id}"`)
  })

  it('페이지 규칙 — 제목, 뷰포트, 어두운 모드 토큰', () => {
    expect(html).toContain('<title>K 템플릿 목업</title>')
    expect(html).toContain('name="viewport"')
    expect(html).toContain('prefers-color-scheme:dark')
  })

  it('이름은 이스케이프한다', () => {
    const own = buildMockHtml([t], { title: '시험 <목업>' })
    expect(own).toContain('시험 &lt;템플릿&gt;')
    expect(own).toContain('<title>시험 &lt;목업&gt;</title>')
    expect(own).not.toContain('<템플릿>')
  })

  it('같은 입력이면 같은 결과다', () => {
    expect(buildMockHtml([t])).toBe(buildMockHtml([t]))
  })
})
