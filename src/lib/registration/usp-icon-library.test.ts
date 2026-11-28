import { afterEach, describe, it, expect, vi } from 'vitest'
import { getUspIconLibrary, iconLibraryPrefix, selectUspIcon, type UspIconManifest } from './usp-icon-library'
import catalog from './usp-icon-catalog.json'

const manifest: UspIconManifest = {
  model: 'gemini-3.1-flash-image',
  icons: [
    { slug: 'easy-use', title: '간편 사용', keywords: ['간편', '원터치', '돌리기만'], url: 'https://x/easy-use.png' },
    { slug: 'large-capacity', title: '대용량', keywords: ['대용량', '넉넉'], url: 'https://x/large-capacity.png' },
    { slug: 'party', title: '파티·이벤트', keywords: ['파티', '생일', '축하'], url: 'https://x/party.png' },
    { slug: 'color-variety', title: '다양한 컬러', keywords: ['컬러', '색상'], url: 'https://x/color.png' },
  ],
}

describe('selectUspIcon (개정 5 — 라이브러리 키워드 매칭)', () => {
  it('제목에 포함된 키워드로 적중한다', () => {
    expect(selectUspIcon('돌리기만 하면 터지는 간편 사용', manifest)?.slug).toBe('easy-use')
    expect(selectUspIcon('10개입 대용량 구성', manifest)?.slug).toBe('large-capacity')
  })

  it('여러 아이콘이 걸리면 키워드 길이 합이 큰 쪽을 고른다', () => {
    // '간편'(2)+'원터치'(3) vs '컬러'(2) — easy-use 우세
    expect(selectUspIcon('원터치 간편 컬러 변경', manifest)?.slug).toBe('easy-use')
  })

  it('공백·구분자 차이를 무시하고 매칭한다', () => {
    expect(selectUspIcon('생일 파티 필수템', manifest)?.slug).toBe('party')
  })

  it('무적중이면 null — 호출자는 저가 모델 폴백 생성으로 진행', () => {
    expect(selectUspIcon('완전히 무관한 문구', manifest)).toBeNull()
    expect(selectUspIcon('', manifest)).toBeNull()
  })
})

describe('getUspIconLibrary — 투명 변환본(v2) 경로', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('런타임은 icon-library-v2의 투명 변환본만 읽는다 — 원본(icon-library)은 보관용', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://lib.test')
    vi.stubEnv('NEXOPS_LITE_ICON_LIBRARY', '1')
    const lib = getUspIconLibrary('user_x')!
    expect(lib.icons).toHaveLength(catalog.length)
    expect(lib.icons[0].url).toBe(`https://lib.test/storage/v1/object/public/sourcing-product-images/user_x/registration/icon-library-v2/${catalog[0].slug}.png`)
    expect(lib.icons.every((i) => i.url.includes('/registration/icon-library-v2/'))).toBe(true)
    expect(iconLibraryPrefix('user_x', 'icon-library')).toBe('user_x/registration/icon-library')
  })

  it('라이트 플래그가 없으면 URL이 있어도 null — Codex 생성 경로로 간다', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://lib.test')
    vi.stubEnv('NEXOPS_LITE_ICON_LIBRARY', '')
    expect(getUspIconLibrary('user_x')).toBeNull()
  })
})
