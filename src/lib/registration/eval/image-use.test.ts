/**
 * 이미지 사용률(W5) — 잡이 만든 컷(성공 URL, 중복 없이) 가운데 렌더 섹션에 나온 컷. 실패 컷·숨긴 요소·장식은 세지 않는다.
 */

import { describe, expect, it } from 'vitest'
import type { CanvasElement, CanvasSection } from '@/lib/registration/editor/types/canvas'
import { ANNOTATION_NAME_PREFIX } from '@/lib/registration/editor/utils/mobileReadability'
import type { PdpJobRow } from '../pdp-state'
import { measureImageUse } from './page-measure'

const img = (src: string, over: Partial<CanvasElement> = {}) =>
  ({ type: 'image', isVisible: true, name: 'img', imageProps: { src }, ...over }) as unknown as CanvasElement
const section = (elements: CanvasElement[]) => ({ elements }) as unknown as CanvasSection
const job = (urls: Array<{ url: string; error?: string }>) =>
  ({ section_images: urls.map((u, i) => ({ section: `s${i}`, ...u })) }) as unknown as Pick<PdpJobRow, 'section_images'>

describe('measureImageUse', () => {
  it('만든 컷 가운데 렌더에 나온 비율 — 같은 URL은 한 번, 실패 컷은 빼고 센다', () => {
    const m = measureImageUse(
      job([{ url: 'a' }, { url: 'b' }, { url: 'a' }, { url: 'c' }, { url: 'x', error: 'fail' }]),
      [section([img('a'), img('a')]), section([img('c'), img('z')])]
    )
    expect(m).toEqual({ generated: 3, used: 2, rate: 0.667 })
  })

  it('숨긴 요소·장식은 쓴 컷이 아니다, 만든 컷이 없으면 1', () => {
    const hidden = img('a', { isVisible: false })
    const badge = img('b', { name: `${ANNOTATION_NAME_PREFIX}x` })
    expect(measureImageUse(job([{ url: 'a' }, { url: 'b' }]), [section([hidden, badge])])).toEqual({
      generated: 2,
      used: 0,
      rate: 0,
    })
    expect(measureImageUse(job([]), [section([img('a')])])).toEqual({ generated: 0, used: 0, rate: 1 })
  })

  it('태스크 키를 주면 그 컷만 센다 — 재합성이 복사한 태스크 밖 컷은 이 잡이 만든 컷이 아니다', () => {
    // s0=a, s1=b, s2=c — 태스크는 s0·s2
    const m = measureImageUse(
      job([{ url: 'a' }, { url: 'b' }, { url: 'c' }]),
      [section([img('a'), img('b')])],
      new Set(['s0', 's2'])
    )
    expect(m).toEqual({ generated: 2, used: 1, rate: 0.5 })
  })
})
