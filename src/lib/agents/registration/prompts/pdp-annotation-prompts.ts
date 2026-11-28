/**
 * 강조 장식(E-3, T4) Vision 위치 판독 프롬프트 — docs/plans/pdp-enrichment/00_DESIGN.md §4.5.
 * 텍스트 조립만 한다(호출은 pdp-annotation-agent.ts, 응답 검증은 lib/registration/pdp-annotation-stage.ts).
 * 모델은 문구를 만들지 않는다 — 목록 문자열을 그대로 고르고 좌표만 돌려준다.
 */

export type AnnotationPromptKind = 'label' | 'leader' | 'zoom'

const KIND_GUIDE: Record<AnnotationPromptKind, string> = {
  label:
    '- "label": a short tag placed right next to a clearly visible part that the label describes. Needs "text", "x", "y".',
  leader:
    '- "leader": a tag placed in an empty corner with a line pointing at a small part. Needs "text", "x", "y" (the point the line touches).',
  zoom: '- "zoom": a circular magnified inset of one small detail. Needs "zoomRect" {"x","y","w","h"} covering that detail (w and h at least 0.15). "text" is optional.',
}

export function buildAnnotationPrompt(labels: string[], kinds: AnnotationPromptKind[]): string {
  return [
    'You are marking points on a product photo for a Korean mobile e-commerce detail page.',
    'Allowed label strings (copy one EXACTLY, character for character — never write new text, never shorten or translate):',
    ...labels.map((l, i) => `${i + 1}. ${l}`),
    '',
    'For each allowed label that names a part or property you can actually SEE in this photo, give the point it refers to.',
    'Skip labels you cannot point at. Return at most 3 items. Return [] if nothing can be pointed at.',
    'Coordinates are fractions of the image: x from left (0) to right (1), y from top (0) to bottom (1). Keep every point between 0.05 and 0.95.',
    'The page crops the top and bottom of the photo — prefer points in the vertical middle band (y between 0.3 and 0.7).',
    'Keep points at least 0.12 apart from each other.',
    'Allowed kinds:',
    ...kinds.map((k) => KIND_GUIDE[k]),
    '',
    'Respond with ONLY a JSON array, no markdown:',
    '[{"kind": "label", "text": "<allowed label>", "x": 0.5, "y": 0.5}]',
  ].join('\n')
}
