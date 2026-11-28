/**
 * 초안의 생성 원천 사진 고르기(결정 카드 c01 — AI 그림 되먹임 막기). 서버·화면이 함께 쓰는 순수 함수다.
 *
 * 생성 결과(썸네일 컷 thumb-·PDP 섹션 컷 pdp-·구운 상세 이미지 detail-page/)는 모두 잡 폴더
 * `{userId}/registration/{jobId}/`에 저장된다(storage.ts). 이 그림이 다음 잡의 원천 사진으로 다시 들어가면
 * 구조 정본·식별 카드·게이트 기준이 AI 그림이 된다 — 그래서 폼 미리 채우기는 이 경로를 뺀다.
 * 사용자가 올린 원본은 `registration/uploads/`(참조 업로드)·`registration/editor-uploads/`(편집기 업로드)라 걸리지 않는다.
 * 지난 초안(detailImages에 생성 컷이 섞인 것, heroImages[0]이 채택 썸네일인 것)도 읽을 때 걸러진다 — 백필 없음.
 */

/** 잡 폴더의 생성 파일 — thumb-·pdp- 파일과 detail-page/ 하위 폴더 */
const GENERATED_REGISTRATION_IMAGE = /\/registration\/[^/]+\/(?:thumb-|pdp-|detail-page\/)/

/** 등록 잡이 만든 그림(썸네일 컷·PDP 섹션 컷·구운 상세 이미지)의 URL인가 */
export function isGeneratedRegistrationImage(url: string): boolean {
  return GENERATED_REGISTRATION_IMAGE.test(url)
}

/** 초안 content에서 원천 사진 고르기에 쓰는 칸만(화면은 초안 GET 응답을 느슨한 모양으로 받는다) */
export interface DraftSourceContent {
  heroImages?: readonly string[] | null
  detailImages?: readonly string[] | null
  /** 썸네일 채택 전 원본 대표 사진(setDraftHeroImage가 남긴다) */
  sourceHeroImage?: string | null
}

/**
 * 폼·썸네일 스튜디오 미리 채우기용 원천 사진 — 원본 대표 사진(sourceHeroImage)을 맨 앞에, 그다음 heroImages·detailImages 순.
 * 생성 경로는 빼고 같은 URL은 한 번만. 개수 자르기는 부르는 쪽이 한다(PdpForm 6장·ThumbnailStudio 3장).
 */
export function draftSourceImageUrls(content: DraftSourceContent | null | undefined): string[] {
  if (!content) return []
  const candidates = [content.sourceHeroImage, ...(content.heroImages ?? []), ...(content.detailImages ?? [])]
  const out: string[] = []
  for (const url of candidates) {
    if (typeof url !== 'string' || url.length === 0) continue
    if (isGeneratedRegistrationImage(url) || out.includes(url)) continue
    out.push(url)
  }
  return out
}
