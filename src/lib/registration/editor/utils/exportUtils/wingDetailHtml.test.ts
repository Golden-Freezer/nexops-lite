import { describe, expect, it } from 'vitest'
import { WING_IMG_STYLE, WING_WRAP_STYLE, buildWingDetailHtml, visibleWingHtmlNote } from './wingDetailHtml'

const A = 'https://example.supabase.co/storage/v1/object/public/b/u/registration/j/detail-page/r/full-01.jpg'
const B = 'https://example.supabase.co/storage/v1/object/public/b/u/registration/j/detail-page/r/full-02.webp'

describe('buildWingDetailHtml', () => {
  it('주소 순서대로 img 를 잇고 바깥 div·img 에 틈 없는 style 을 단다', () => {
    const html = buildWingDetailHtml([A, B], '크림 용기 10g')
    expect(html).toBe(
      `<div style="${WING_WRAP_STYLE}">\n` +
        `<img src="${A}" alt="크림 용기 10g 상세 이미지 1" style="${WING_IMG_STYLE}">\n` +
        `<img src="${B}" alt="크림 용기 10g 상세 이미지 2" style="${WING_IMG_STYLE}">\n` +
        '</div>\n',
    )
  })

  it('상품명이 비면 alt 는 "상세 이미지 N"', () => {
    expect(buildWingDetailHtml([A], '  ')).toContain('alt="상세 이미지 1"')
    expect(buildWingDetailHtml([A], null)).toContain('alt="상세 이미지 1"')
  })

  it('상품명의 따옴표·꺾쇠는 속성 밖으로 새지 않게 바꾼다', () => {
    const html = buildWingDetailHtml([A], '용기 "6개" <세트> & 뚜껑')
    expect(html).toContain('alt="용기 &quot;6개&quot; &lt;세트&gt; &amp; 뚜껑 상세 이미지 1"')
  })

  it('주소가 없거나 http(s) 가 아니면 오류', () => {
    expect(() => buildWingDetailHtml([], 'x')).toThrow('붙여 넣을 이미지 주소가 없습니다.')
    expect(() => buildWingDetailHtml([A, ''], 'x')).toThrow('(빈 값)')
    expect(() => buildWingDetailHtml(['javascript:alert(1)'], 'x')).toThrow('올바르지 않습니다')
    expect(() => buildWingDetailHtml(['https://a b/c.jpg'], 'x')).toThrow('올바르지 않습니다')
  })
})

describe('visibleWingHtmlNote (#1320 검수 S1)', () => {
  it('글을 만든 저장 결과와 지금 결과가 같은 목록일 때만 보인다', () => {
    const run1 = [A, B]
    const note = { forUrls: run1, text: '복사했습니다' }
    expect(visibleWingHtmlNote(note, run1)).toBe('복사했습니다')
  })

  it('다시 굽기로 run 이 바뀌면(주소가 같아도 새 목록) 옛 글은 안 보인다', () => {
    const note = { forUrls: [A, B], text: '복사했습니다' }
    expect(visibleWingHtmlNote(note, [A, B])).toBeNull()
    expect(visibleWingHtmlNote(note, [B])).toBeNull()
  })

  it('저장 결과가 없거나 글이 없으면 null', () => {
    const run1 = [A]
    expect(visibleWingHtmlNote({ forUrls: run1, text: 'x' }, null)).toBeNull()
    expect(visibleWingHtmlNote(null, run1)).toBeNull()
  })
})
