/**
 * 생성 화면 참조 사진 칸(결정 카드 c12·J20) — 첫 장 대표 표시, 사진마다 앞·대표·뒤·제거 버튼(끝 자리는 막힘), 역할 칸은 showRoles일 때만,
 * 첫 장 경고(생성 경로·저해상도). 서버 렌더 마크업만 본다(DOM 없음 — 누르기 동작은 순서 도우미 시험·render-check가 본다).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PHOTO_ROLES_HINT, PdpFormPhotos } from './PdpFormPhotos'
import { FIRST_PHOTO_GENERATED_MESSAGE, FIRST_PHOTO_LOW_RES_MESSAGE, type SourcePhotoRole } from '@/lib/registration/source-photo-roles'
import type { ImageDimensions } from '@/lib/registration/reference-image-quality'

beforeAll(() => vi.stubGlobal('React', React))
afterAll(() => vi.unstubAllGlobals())

const A = 'https://cdn.example.com/registration/uploads/a.jpg'
const B = 'https://cdn.example.com/registration/uploads/b.jpg'
const C = 'https://cdn.example.com/registration/uploads/c.jpg'

const render = (urls: string[], opts: { roles?: SourcePhotoRole[]; showRoles?: boolean; dims?: Record<string, ImageDimensions> } = {}) =>
  renderToStaticMarkup(
    createElement(PdpFormPhotos, {
      urls,
      onUrlsChange: () => {},
      roles: opts.roles ?? [],
      onRolesChange: () => {},
      showRoles: opts.showRoles ?? false,
      imageDims: opts.dims ?? {},
      onDims: () => {},
      maxImages: 6,
      uploading: false,
      busy: false,
      fileRef: { current: null },
      onFiles: () => {},
    })
  )

const attrOf = (html: string, label: string) => html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))?.[0] ?? ''

describe('PdpFormPhotos', () => {
  it('첫 장만 대표 표시, 사진마다 앞·대표·뒤·제거 버튼 — 첫 장의 앞·대표, 끝 장의 뒤는 막힌다', () => {
    const html = render([A, B, C])
    expect(html.match(/data-photo-index="/g)).toHaveLength(3)
    expect(html.match(/data-photo-hero=""/g)).toHaveLength(1)
    expect(html.match(/>대표</g)).toHaveLength(1)
    for (const i of [1, 2, 3]) for (const what of ['앞으로', '대표로', '뒤로', '제거']) expect(attrOf(html, `이미지 ${i} ${what}`), `${i} ${what}`).not.toBe('')
    expect(attrOf(html, '이미지 1 앞으로')).toContain(' disabled=""')
    expect(attrOf(html, '이미지 1 대표로')).toContain(' disabled=""')
    expect(attrOf(html, '이미지 1 뒤로')).not.toContain(' disabled=""')
    expect(attrOf(html, '이미지 2 대표로')).not.toContain(' disabled=""')
    expect(attrOf(html, '이미지 3 뒤로')).toContain(' disabled=""')
  })

  it('역할 칸은 showRoles일 때만 — 고른 역할이 선택되고 안내 줄에 빠지는 장 수', () => {
    expect(render([A, B])).not.toContain('<select')
    expect(render([A, B])).not.toContain(PHOTO_ROLES_HINT)
    const html = render([A, B, C], { showRoles: true, roles: [{ url: B, role: 'explain' }, { url: C, role: 'option' }] })
    expect(html.match(/<select/g)).toHaveLength(3)
    expect(html).toMatch(/data-photo-index="1" data-photo-role="explain"/)
    expect(html).toMatch(/data-photo-index="2" data-photo-role="option"/)
    expect(html).toContain('<option value="explain" selected="">설명 그림</option>')
    expect(html).toContain(`${PHOTO_ROLES_HINT} 지금 1장이 원천에서 빠집니다.`)
  })

  it('시험 사진(J57) — 역할 목록에 늘 있고, 고르면 원천에서 빠지는 장으로 세며 안내 줄이 시연 칸(켠 잡)에서만 쓰인다고 말한다', () => {
    const html = render([A, B], { showRoles: true, roles: [{ url: B, role: 'demo' }] })
    expect(html.match(/<option value="demo"/g)).toHaveLength(2)
    expect(html).toContain('<option value="demo" selected="">시험 사진</option>')
    expect(html).toMatch(/data-photo-index="1" data-photo-role="demo"/)
    expect(PHOTO_ROLES_HINT).toContain('시험 사진(직접 시험한 사진)은 시연 칸(켠 잡)에서만 쓰이고 생성 원천에서 빠집니다.')
    expect(html).toContain(`${PHOTO_ROLES_HINT} 지금 1장이 원천에서 빠집니다.`)
  })

  it('첫 장 경고 — 생성 경로·저해상도, 문제가 없으면 없음', () => {
    const generated = 'https://cdn.example.com/u1/registration/job-1/pdp-hero.png'
    expect(render([generated, A])).toContain(FIRST_PHOTO_GENERATED_MESSAGE)
    expect(render([A, B], { dims: { [A]: { width: 300, height: 300 } } })).toContain(FIRST_PHOTO_LOW_RES_MESSAGE)
    const ok = render([A, B], { dims: { [A]: { width: 1200, height: 1200 } } })
    expect(ok).not.toContain('data-photo-warning')
  })

  it('6장이면 업로드 칸이 없다', () => {
    expect(render([A, B, C])).toContain('업로드')
    expect(render([A, B, C, `${A}?4`, `${A}?5`, `${A}?6`])).not.toContain('업로드')
  })

  it('역할 칸에 포장이 보이고 고르면 선택된다(J58)', () => {
    const html = render([A, B], { showRoles: true, roles: [{ url: B, role: 'package' }] })
    expect(html).toMatch(/data-photo-index="1" data-photo-role="package"/)
    expect(html).toContain('<option value="package" selected="">포장</option>')
  })
})
