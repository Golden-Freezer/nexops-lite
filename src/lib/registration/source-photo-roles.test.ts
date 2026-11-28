/**
 * 원천 사진 순서·역할(결정 카드 c12·J20) — 정리·역할 바꾸기·생성 원천·식별 카드 역할 줄·순서 도우미·첫 장 경고. 순수 함수.
 */

import { describe, expect, it } from 'vitest'
import {
  cleanSourcePhotoRoles,
  FIRST_PHOTO_GENERATED_MESSAGE,
  FIRST_PHOTO_LOW_RES_MESSAGE,
  firstPhotoWarning,
  generationSourceUrls,
  hasPackagePhoto,
  identityRoleLine,
  moveItem,
  moveToFront,
  photoRoleOf,
  rolesForUrls,
  withPhotoRole,
} from './source-photo-roles'

const A = 'https://cdn.example.com/registration/uploads/a.jpg'
const B = 'https://cdn.example.com/registration/uploads/b.jpg'
const C = 'https://cdn.example.com/registration/uploads/c.jpg'
const GENERATED = 'https://cdn.example.com/u1/registration/job-1/pdp-hero.png'

describe('cleanSourcePhotoRoles — 잡 생성 라우트 정리', () => {
  it('sourceImages에 있는 주소·옵션·설명 그림만, 같은 주소는 처음 한 번, 원본·모르는 역할은 버린다', () => {
    const raw = [
      { url: ` ${B} `, role: 'option' },
      { url: B, role: 'explain' },
      { url: C, role: 'original' },
      { url: 'https://elsewhere.example.com/x.jpg', role: 'explain' },
      { url: A, role: 'hero' },
      null,
      'x',
      { url: C, role: 'explain' },
    ]
    expect(cleanSourcePhotoRoles(raw, [A, B, C])).toEqual([
      { url: B, role: 'option' },
      { url: C, role: 'explain' },
    ])
  })

  it('배열이 아니면 빈 목록', () => {
    expect(cleanSourcePhotoRoles(undefined, [A])).toEqual([])
    expect(cleanSourcePhotoRoles({ url: A, role: 'option' }, [A])).toEqual([])
  })
})

describe('역할 읽기·바꾸기(화면)', () => {
  it('기록이 없으면 원본, 원본으로 돌리면 줄을 지우고, 다른 역할은 바꾼다', () => {
    expect(photoRoleOf(undefined, A)).toBe('original')
    const one = withPhotoRole([], B, 'option')
    expect(one).toEqual([{ url: B, role: 'option' }])
    expect(photoRoleOf(one, B)).toBe('option')
    expect(withPhotoRole(one, B, 'explain')).toEqual([{ url: B, role: 'explain' }])
    expect(withPhotoRole(one, B, 'original')).toEqual([])
  })

  it('지운 사진의 역할 줄은 남기지 않는다', () => {
    expect(rolesForUrls([{ url: B, role: 'option' }, { url: C, role: 'explain' }], [A, C])).toEqual([{ url: C, role: 'explain' }])
  })
})

describe('generationSourceUrls — 생성 원천', () => {
  it('설명 그림을 순서 그대로 빼고 뺀 것을 돌려준다', () => {
    expect(generationSourceUrls([A, B, C], [{ url: B, role: 'explain' }, { url: C, role: 'option' }])).toEqual({ urls: [A, C], excluded: [B], fallback: false })
  })

  it('역할이 없거나 설명 그림이 없으면 그대로', () => {
    expect(generationSourceUrls([A, B], undefined)).toEqual({ urls: [A, B], excluded: [], fallback: false })
    expect(generationSourceUrls([A, B], [{ url: B, role: 'option' }])).toEqual({ urls: [A, B], excluded: [], fallback: false })
  })

  it('다 설명 그림이면 원래 목록을 쓴다(원천 없이 만들지 않는다)', () => {
    expect(generationSourceUrls([A, B], [{ url: A, role: 'explain' }, { url: B, role: 'explain' }])).toEqual({ urls: [A, B], excluded: [], fallback: true })
  })
})

describe('identityRoleLine — 식별 카드 역할 한 줄', () => {
  it('옵션 사진이 없으면 null(지금 지시 그대로)', () => {
    expect(identityRoleLine(['original'])).toBeNull()
    expect(identityRoleLine(['original', 'original'])).toBeNull()
    expect(identityRoleLine([])).toBeNull()
  })

  it('옵션 사진 자리를 1부터 적고, 그 색·무늬·구성을 상품 자체 특징으로 적지 말라고 한다', () => {
    expect(identityRoleLine(['original', 'option'])).toBe(
      "Photo roles: photo 2 shows the same product in another purchase option (a different color, pattern or set). Describe the product's shared form once and do not state an option photo's color, pattern or set as the product's own."
    )
    expect(identityRoleLine(['original', 'option', 'original', 'option'])).toMatch(/^Photo roles: photo 2, photo 4 show the same product/)
  })
})

describe('순서 도우미(화면)', () => {
  it('앞·뒤로 옮기기, 범위 밖이면 그대로(새 배열)', () => {
    expect(moveItem([A, B, C], 1, 0)).toEqual([B, A, C])
    expect(moveItem([A, B, C], 1, 2)).toEqual([A, C, B])
    const list = [A, B]
    const same = moveItem(list, 0, -1)
    expect(same).toEqual([A, B])
    expect(same).not.toBe(list)
    expect(moveItem([A, B], 1, 2)).toEqual([A, B])
  })

  it('대표 지정 = 맨 앞으로, 나머지 순서는 그대로', () => {
    expect(moveToFront([A, B, C], 2)).toEqual([C, A, B])
    expect(moveToFront([A, B, C], 0)).toEqual([A, B, C])
  })
})

describe('firstPhotoWarning — 첫 장 경고', () => {
  it('첫 장이 생성 경로면 생성 경고(저해상도보다 먼저)', () => {
    expect(firstPhotoWarning([GENERATED, A], { [GENERATED]: { width: 100, height: 100 } })).toBe(FIRST_PHOTO_GENERATED_MESSAGE)
  })

  it('첫 장이 저해상도면 저해상도 경고 — 두 번째 장만 작으면 없음', () => {
    expect(firstPhotoWarning([A, B], { [A]: { width: 300, height: 400 } })).toBe(FIRST_PHOTO_LOW_RES_MESSAGE)
    expect(firstPhotoWarning([A, B], { [A]: { width: 1200, height: 900 }, [B]: { width: 100, height: 100 } })).toBeNull()
  })

  it('크기를 아직 모르거나 사진이 없으면 null', () => {
    expect(firstPhotoWarning([A], {})).toBeNull()
    expect(firstPhotoWarning([], {})).toBeNull()
  })
})

describe('포장 역할(J58)', () => {
  it('정리는 포장을 받고, 생성 원천은 포장 사진을 빼지 않는다(설명 그림만 뺀다)', () => {
    expect(cleanSourcePhotoRoles([{ url: B, role: 'package' }, { url: C, role: 'explain' }], [A, B, C])).toEqual([
      { url: B, role: 'package' },
      { url: C, role: 'explain' },
    ])
    expect(generationSourceUrls([A, B, C], [{ url: B, role: 'package' }, { url: C, role: 'explain' }])).toEqual({ urls: [A, B], excluded: [C], fallback: false })
    expect(generationSourceUrls([A, B], [{ url: B, role: 'package' }])).toEqual({ urls: [A, B], excluded: [], fallback: false })
  })

  it('hasPackagePhoto — 원천 주소에 붙은 포장 역할만 센다', () => {
    expect(hasPackagePhoto([A, B], [{ url: B, role: 'package' }])).toBe(true)
    expect(hasPackagePhoto([A, B], [{ url: B, role: 'option' }])).toBe(false)
    expect(hasPackagePhoto([A], [{ url: B, role: 'package' }])).toBe(false)
    expect(hasPackagePhoto([A, B], undefined)).toBe(false)
    expect(hasPackagePhoto([A, B], null)).toBe(false)
  })
})
