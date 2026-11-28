import { describe, expect, it } from 'vitest'
import { parseOptionLabels, primaryFormAxis } from '@/lib/registration/options/option-spec'
import { isFactClaimSafe } from '@/lib/registration/eval/claim-lexicon'
import { productInfoRows } from '@/lib/registration/product-info-rows'
import { specFactLines } from '@/lib/registration/spec-facts'
import { specSheetPromptJson, withIdentityNote } from '@/lib/registration/pdp-state'
import {
  PDP_TEST_PRODUCT_IDS,
  getPdpTestProduct,
  isReadyForLiveTest,
  listPdpTestProducts,
  resolvePdpPhotoPath,
  resolvePdpProductPath,
  toPdpTestProduct,
} from './index'

const products = listPdpTestProducts()
const V2 = new Set(['beauty', 'digital', 'fashion', 'food', 'household'])

describe('실 테스트 상품 픽스처 P01~P11', () => {
  it('11개가 순서대로 있고 ID가 고유하다', () => {
    expect(products.map((p) => p.id)).toEqual([...PDP_TEST_PRODUCT_IDS])
    expect(getPdpTestProduct('P07').specSheet.productName).toContain('밥그릇')
    expect(getPdpTestProduct('P11').specSheet.productName).toContain('카네이션')
    expect(() => getPdpTestProduct('P12')).toThrow()
  })

  it('04_TEST_PROGRAM §1 카테고리·근거 경로', () => {
    expect(products.map((p) => p.categoryKey)).toEqual([
      'stationery', 'packaging', 'beauty', 'beauty', 'beauty', 'pet', 'pet', 'household', 'digital', 'fashion', 'stationery',
    ])
    for (const p of products) {
      expect(p.evidencePath).toBe(V2.has(p.categoryKey) ? 'v2' : 'pooled')
      expect(p.specSheet.category).toBe(p.categoryKey)
    }
  })

  it.each(products.map((p) => [p.id, p] as const))('%s 원천 사진은 사람이 고른 우리 상품 사진 1~3장', (_id, p) => {
    expect(p.sourcePhotos.length).toBeGreaterThanOrEqual(1)
    expect(p.sourcePhotos.length).toBeLessThanOrEqual(3)
    for (const photo of [...p.sourcePhotos, ...Object.values(p.optionImages ?? {})]) {
      const path = photo.path ?? photo.programPath ?? photo.url ?? ''
      expect(path).not.toMatch(/경쟁사|리뷰/)
      // 이름 어디에 있어도 거른다(앞에 날짜가 붙은 현행 페이지 포함)
      expect(path).not.toMatch(/product-page-|nexfit_|상세페이지|Gemini_Generated|featured-image|image-(hero|detail)|Generated Image|solution_img|call_to_action/)
      expect(path).not.toMatch(/^[A-Za-z]:[\\/]|^\//)
      expect(photo.note.length).toBeGreaterThan(0)
    }
  })

  it.each(products.map((p) => [p.id, p] as const))('%s spec_sheet는 출처 있는 사실만, 가격 없음', (_id, p) => {
    const filled = Object.keys(p.specSheet)
    expect(Object.keys(p.fieldSources).sort()).toEqual([...filled].sort())
    expect(p.emptyFields.filter((f) => filled.includes(f))).toEqual([])
    expect(p.specSheet.colorOptions ?? []).toEqual(p.optionLabels)
    const text = JSON.stringify(p.specSheet)
    expect(text).not.toMatch(/\d[\d,]*\s*원|가격|할인|쿠폰/)
    // 리뷰는 경쟁사 파일뿐이라 쓰지 않는다
    expect(p.specSheet.reviewsText).toBeUndefined()
    expect(p.specSheet.rating).toBeUndefined()
  })

  it('오너 확인이 남은 상품이 없다(P02 사진 출처는 2026-10-27 오너 확인), 남으면 준비 안 됨', () => {
    expect(products.filter((p) => !isReadyForLiveTest(p)).map((p) => p.id)).toEqual([])
    expect(isReadyForLiveTest({ ...getPdpTestProduct('P02'), ownerChecks: ['확인 필요'] })).toBe(false)
  })

  it('P02 참조 사진은 글자 배지·작은 로고를 이어 채우고 타사 브랜드를 가장자리 없이 흐린다(원본 파일은 그대로, 데이지 꽃잎은 흐리지 않음)', () => {
    const p02 = getPdpTestProduct('P02')
    const [photo] = p02.sourcePhotos
    expect(photo.origin).toBe('self_photo')
    expect(photo.edits?.map((e) => e.kind)).toEqual(['inpaint', 'inpaint', 'blur'])
    expect(photo.edits?.[2]).toMatchObject({ feather: 28, keepWhite: true })
    // 옵션 카드 사진도 같은 원본이라 같은 편집
    expect(p02.optionImages?.['데이지']?.edits).toEqual(photo.edits)
  })

  it('개인정보·키·절대경로 0', () => {
    const all = JSON.stringify(products)
    expect(all).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/)
    expect(all).not.toMatch(/01[016789]-?\d{3,4}-?\d{4}/)
    expect(all).not.toMatch(/user_[A-Za-z0-9]{10,}|sk-[A-Za-z0-9]{10,}|eyJ[A-Za-z0-9_-]{10,}/)
    expect(all).not.toMatch(/[A-Za-z]:\\\\|\\\\Users\\\\|\/Users\//)
  })

  it('오너 메모 정정(11-01) — P07 높이 조절은 불가로 카피 사실에 가고 표에는 안 실리며, P09 사용처는 규제 표현 없이 여행 상황이다', () => {
    const p07 = getPdpTestProduct('P07').specSheet
    expect(specFactLines(p07)).toContain('- 높이 조절: 불가')
    expect(specFactLines(p07).join('\n')).not.toContain('높이 조절: 가능')
    expect(productInfoRows(p07).map((row) => row.label)).not.toContain('높이 조절')
    const usage = getPdpTestProduct('P09').specSheet.usageLocation ?? ''
    expect(usage).toContain('여행')
    expect(isFactClaimSafe(usage, undefined)).toBe(true)
  })

  it('오너 답 정정(11-01) — P05 소재, P11 문구, P07 식별 카드 특징은 카피 프롬프트에 안 간다', () => {
    expect(getPdpTestProduct('P05').specSheet.material).toContain('플라스틱')
    expect(getPdpTestProduct('P11').specSheet.extraSpecs?.find((e) => e.key === '문구')?.value).toBe('Thank You')
    const p07 = getPdpTestProduct('P07').specSheet
    expect(p07.identityNote).toContain('cap')
    expect(specSheetPromptJson(p07)).not.toContain('identityNote')
    expect(withIdentityNote('PRODUCT IDENTITY: 2 bowls', p07.identityNote)).toBe(`PRODUCT IDENTITY: 2 bowls, ${p07.identityNote}`)
    expect(withIdentityNote('', p07.identityNote)).toContain(p07.identityNote as string)
    expect(withIdentityNote('PRODUCT IDENTITY: 2 bowls', undefined)).toBe('PRODUCT IDENTITY: 2 bowls')
    expect(withIdentityNote('', ' ')).toBe('')
  })

  it('다옵션 상품의 옵션명이 축으로 나뉜다(05_OPTIONS §6)', () => {
    const axes = (id: string) => parseOptionLabels(getPdpTestProduct(id).optionLabels).spec.axes.map((a) => a.kind)
    // P01은 오너 지시(10-31)로 디자인 7개만 — 수량은 옵션 칩에서 뺐다
    expect(axes('P01')).toEqual(['design'])
    expect(axes('P02')).toEqual(['design', 'size'])
    expect(axes('P05')).toEqual(['quantity'])
    expect(axes('P10')).toEqual(['quantity'])
    for (const id of ['P03', 'P04', 'P06', 'P07', 'P08', 'P09']) expect(getPdpTestProduct(id).optionLabels).toHaveLength(1)
    // P11은 N 트랙 비교용으로 한 디자인만 둔 단일 상품(옵션명 없음)
    expect(getPdpTestProduct('P11').optionLabels).toEqual([])
  })

  it('옵션 카드 사진의 키는 형태 축 값이다', () => {
    for (const p of products) {
      if (!p.optionImages) continue
      const primary = primaryFormAxis(parseOptionLabels(p.optionLabels).spec)
      for (const key of Object.keys(p.optionImages)) expect(primary?.values).toContain(key)
    }
  })

  it('원천 사진 경로는 env의 상품 소싱 폴더 기준으로만 푼다', () => {
    const p = getPdpTestProduct('P03')
    expect(resolvePdpProductPath(p, 'a.png', 'D:/src')).toMatch(/src[\\/]두피브러쉬[\\/]a\.png$/)
    expect(() => resolvePdpProductPath(p, 'a.png', '')).toThrow('NEXOPS_PDP_PRODUCT_ROOT')
  })

  it('렌더한 디자인 그림(design_render)은 기록 폴더 기준으로만 푼다 — 소싱 폴더에 쓰지 않는다', () => {
    const p = getPdpTestProduct('P11')
    const [photo] = p.sourcePhotos
    expect(photo.origin).toBe('design_render')
    expect(photo.path).toBeUndefined()
    expect(resolvePdpPhotoPath(p, photo, { programDir: 'D:/prog' })).toMatch(/prog[\\/]photos[\\/]P11[\\/]love01-design\.png$/)
    expect(() => resolvePdpPhotoPath(p, photo, { productRoot: 'D:/src' })).toThrow('NEXOPS_PDP_PROGRAM_DIR')
    const p03 = getPdpTestProduct('P03')
    expect(resolvePdpPhotoPath(p03, p03.sourcePhotos[0], { productRoot: 'D:/src' })).toMatch(/src[\\/]두피브러쉬[\\/]/)
  })

  it('깨진 픽스처는 거부한다', () => {
    const good = getPdpTestProduct('P01')
    expect(() => toPdpTestProduct({ ...good, sourcePhotos: [] })).toThrow()
    expect(() => toPdpTestProduct({ ...good, evidencePath: 'v3' })).toThrow()
    expect(() => toPdpTestProduct({ ...good, sourcePhotos: [{ note: 'x' }] })).toThrow()
    // design_render는 programPath로만, programPath는 design_render로만, 경로는 하나만
    expect(() => toPdpTestProduct({ ...good, sourcePhotos: [{ origin: 'design_render', path: 'a.png', note: 'x' }] })).toThrow()
    expect(() => toPdpTestProduct({ ...good, sourcePhotos: [{ origin: 'other', programPath: 'a.png', note: 'x' }] })).toThrow()
    expect(() => toPdpTestProduct({ ...good, sourcePhotos: [{ origin: 'other', path: 'a.png', url: 'https://x/a.png', note: 'x' }] })).toThrow()
    const photo = good.sourcePhotos[0]
    expect(() => toPdpTestProduct({ ...good, sourcePhotos: [{ ...photo, edits: [{ kind: 'crop', box: [0, 0, 1, 1], note: 'x' }] }] })).toThrow()
    expect(() => toPdpTestProduct({ ...good, sourcePhotos: [{ ...photo, edits: [{ kind: 'fill', box: [0, 0, 0, 1], note: 'x' }] }] })).toThrow()
    expect(() => toPdpTestProduct({ ...good, sourcePhotos: [{ ...photo, edits: [{ kind: 'blur', box: [0, 0, 1, 1], note: '' }] }] })).toThrow()
    // feather·keepWhite는 blur에만, feather는 양의 정수
    const edit = (e: object) => toPdpTestProduct({ ...good, sourcePhotos: [{ ...photo, edits: [{ box: [0, 0, 1, 1], note: 'x', ...e }] }] })
    expect(edit({ kind: 'inpaint' }).sourcePhotos[0].edits?.[0].kind).toBe('inpaint')
    expect(edit({ kind: 'blur', feather: 8, keepWhite: true }).sourcePhotos[0].edits?.[0]).toMatchObject({ feather: 8, keepWhite: true })
    expect(() => edit({ kind: 'fill', feather: 8 })).toThrow()
    expect(() => edit({ kind: 'inpaint', keepWhite: true })).toThrow()
    expect(() => edit({ kind: 'blur', feather: 0 })).toThrow()
    // 리뷰 파일: 종류·메모 필수, 경로는 기록 폴더 안 상대 경로만
    const file = { kind: 'own', programPath: 'reviews-wing/P01-own-wing.xlsx', note: 'x' }
    expect(toPdpTestProduct({ ...good, reviewFiles: [file] }).reviewFiles).toEqual([file])
    for (const bad of [
      { ...file, kind: 'mine' },
      { ...file, note: '' },
      { kind: 'own', programPath: file.programPath },
      { ...file, note: 3 },
      { ...file, programPath: '' },
      { ...file, programPath: '../reviews/x.xlsx' },
      { ...file, programPath: 'reviews/../../x.xlsx' },
      { ...file, programPath: 'C:/Users/x.xlsx' },
      { ...file, programPath: '/tmp/x.xlsx' },
    ]) {
      expect(() => toPdpTestProduct({ ...good, reviewFiles: [bad] }), JSON.stringify(bad)).toThrow()
    }
    expect(() => toPdpTestProduct({ ...good, reviewFiles: file })).toThrow()
  })
})
