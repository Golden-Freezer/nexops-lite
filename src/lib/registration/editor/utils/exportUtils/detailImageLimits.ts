/**
 * 상세 이미지 굽기(U1) 한도 — 브라우저 굽기(bakeDetailImages)와 서버 라우트(detail-images)가 함께 쓴다.
 * 근거: 옵시디언 쿠팡 샘플 집계(RUN-LOG 세션 B U1 — 섹션 평균 높이 p95 2,083px, 상세 길이 중앙값 11,489px), 통합 승인 2026-10-27.
 */

import { PAGE_DESIGN_WIDTH } from '@/lib/registration/templatelib/template-types'

/** 편집기 캔버스 폭 — 템플릿과 페이지 길이는 이 폭으로 짠다. 내보내는 폭은 PAGE_EXPORT_WIDTH(오너 11-02: 860으로 짜고 내보낼 때 780으로 줄인다) */
export const DETAIL_CANVAS_WIDTH = PAGE_DESIGN_WIDTH
/** 줄이기 전에 찍는 배율 — 1배로 찍어 줄이면 글자가 무뎌진다 */
export const EXPORT_CAPTURE_SCALE = 2
/** 섹션 이미지 장당 높이 상한 — 이보다 긴 섹션만 나눈다 */
export const SLICE_MAX_PX = 3000
/** 전체 이미지 조각 높이 상한 — 넘으면 이어 붙어 보이는 조각(쿠팡 IMAGE_NO_SPACE) */
export const FULL_CHUNK_MAX_PX = 20000
/** Chrome 캔버스 한 변 한도 — 이어 붙인 미리보기 1장은 이 높이 이하일 때만 만든다 */
export const CANVAS_MAX_SIDE_PX = 32767
/** 파일당 용량 상한(쿠팡 상세 이미지 한도는 미확인 — 보수적으로) */
export const FILE_MAX_BYTES = 5 * 1024 * 1024
export const JPEG_QUALITIES = [0.92, 0.85, 0.78] as const
/** 이보다 낮은 섹션은 섹션 이미지를 따로 내지 않고 앞 섹션 이미지에 붙인다 */
export const MIN_SECTION_IMAGE_PX = 120

/**
 * 전체 이미지 형식 — JPEG 조각과 GIF 칸의 움직이는 WebP(세션 B ③ P4). 쿠팡 상세는 이미지 업로드(IMAGE_NO_SPACE) 목록이고
 * Wing 파일 선택이 webp를 받으며, 움직이는 WebP를 다시 인코딩하지 않고 그대로 보여 준다(통합 gif-delivery 10절, 실제 상품 DOM 확인).
 * 섹션 이미지·이어 붙인 미리보기는 JPEG만이다.
 */
export const DETAIL_IMAGE_EXT = { 'image/jpeg': 'jpg', 'image/webp': 'webp' } as const
export type DetailImageMime = keyof typeof DETAIL_IMAGE_EXT
export type DetailImageExt = (typeof DETAIL_IMAGE_EXT)[DetailImageMime]
/** 전체 이미지 목록 안 움직이는 WebP 장수 상한(움직이는 칸 자리 규칙: 대표 칸 포함 3칸 — motion/pick MOTION_CELLS_MAX, 1칸 여유) */
export const MOTION_MAX_FULL_FILES = 4
/** 페이지 움직임 합 예산 — motion/encode.ts MOTION_ENCODE.pageMaxBytes와 같은 값(그 파일은 sharp를 불러 브라우저가 import하지 않는다) */
export const MOTION_PAGE_MAX_BYTES = 3000 * 1024
