/**
 * 대표이미지 스타일 프롬프트 (WS-B) — 상품명 기반 4스타일 프롬프트 조립(순수 함수).
 *
 * 쿠팡 대표이미지 관례에 맞춘 4종: 순백 심플 / 라이프스타일 연출 / 스펙 강조 / 프리미엄 감성.
 * 모든 프롬프트는 한글 상품명·문구를 정확한 맞춤법으로 렌더하도록 지시한다(파일럿에서 두 모델 검증).
 */

export interface ImageStyle {
  key: string
  label: string
}

export const IMAGE_STYLES: ImageStyle[] = [
  { key: 'white', label: '순백 심플' },
  { key: 'lifestyle', label: '라이프스타일' },
  { key: 'infographic', label: '스펙 강조' },
  { key: 'premium', label: '프리미엄' },
]

const COMMON = '정사각형 1:1, 고해상도, 정확한 한글 맞춤법의 텍스트, 워터마크 없음.'

/** 스타일별 대표이미지 프롬프트. 상품명이 비면 '상품'으로 폴백. */
export function buildStylePrompt(productName: string, styleKey: string): string {
  const name = productName.trim() || '상품'
  switch (styleKey) {
    case 'lifestyle':
      return `쿠팡 이커머스 대표이미지. "${name}"을(를) 실제 사용 환경(집·책상 등)에 자연스럽게 연출한 라이프스타일 컷. 밝고 따뜻한 조명, 상단에 제품명 "${name}" 텍스트를 선명하게. ${COMMON}`
    case 'infographic':
      return `쿠팡 이커머스 대표이미지. 순백색 배경 위 "${name}" 제품 사진과 핵심 특징을 가리키는 간결한 한글 스펙 콜아웃(2~3개). 상단에 제품명 "${name}". 깔끔한 인포그래픽 스타일. ${COMMON}`
    case 'premium':
      return `쿠팡 이커머스 대표이미지. "${name}"을(를) 고급스러운 무드로 촬영(부드러운 그림자·질감 강조·차분한 배경). 상단에 제품명 "${name}" 텍스트를 세련되게. 프리미엄 감성. ${COMMON}`
    case 'white':
    default:
      return `쿠팡 이커머스 대표이미지. 순백색 배경 위에 "${name}" 제품 사진. 상단에 제품명 "${name}" 텍스트를 크고 선명하게. 깔끔한 스튜디오 조명, 미니멀. ${COMMON}`
  }
}
