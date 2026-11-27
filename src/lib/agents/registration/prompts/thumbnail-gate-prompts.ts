/**
 * 동일성 게이트 프롬프트·임계 상수 — NEXFIT server/thumbnail/gate.py 번역.
 * 판정 로직(evaluateCut/composeGate)은 thumbnail-gate-agent.ts에 있다.
 */

// NEXFIT gate.py:12-16 — 2026-07-28 실측 재조정: 규격컷 15장 실측 점유율 0.30~0.65(중위 0.50).
// 종전 경고 0.92~1.0 / 하드 하한 0.85는 생성물이 도달할 수 없는 값이었다.
export const CUT_OCCUPANCY_TARGET: Record<'cutout' | 'studio', [number, number]> = {
  cutout: [0.55, 1.0],
  studio: [0.6, 0.9],
}
export const CUTOUT_OCCUPANCY_HARD_FLOOR = 0.3
export const DEFAULT_OCCUPANCY_TARGET: [number, number] = [0.6, 0.9]

// NEXFIT agents/image_generation_agent.py:150 IMAGE_QUALITY_THRESHOLDS.consistency_score_min
export const CONSISTENCY_SCORE_MIN = 0.7

// NEXFIT gate.py:62-95 — 원문 유지. JSON 스키마 강제는 없으므로 응답 형식 지시를 말미에 추가.
export const GATE_PROMPT = `You are a product-photo QA judge for Korean e-commerce thumbnails.
The first one or more images are REFERENCE product photos (they may show
multiple color/design variants of the same product). The LAST TWO images are
the generated CUTOUT and then the generated STUDIO image.

For each generated cut, score IDENTITY independently using exact product shape,
observed color, logo/label, material, component ratios, and visible orientation.
If the references show multiple variants, each variant in the generated image
must match one of the reference variants; duplicating one variant in place of
another, or inventing an unseen colorway, is an identity violation.
Set has_artifact=true for stains, malformed edges, invented or garbled text/logo,
missing parts, or product damage. Any mismatch in the product's own printed
text, logos, or patterns versus the references — removed, added, or altered —
is an identity violation. Return consistency from 0.0 to 1.0.

For each generated cut, inspect PRESENTATION independently and answer:
1. Is it one continuous photograph? Set not_continuous_single_photo=true if not.
2. Is there a rectangular or four-sided boundary wrapping both the product and
   any source-photo background? Set rectangular_boundary=true if present.
3. Does the reference crop, background, or arrangement survive together as one
   planar transformed patch? Set planar_source_remnant=true if present.
4. Is the scene surrounded by flat, featureless, single-color margin bands on
   two or more sides, so it reads as a smaller picture placed on a plain
   canvas? Set flat_margin_band=true if so. This applies even when the inner
   scene is newly generated. A physical seamless studio backdrop with natural
   lighting falloff, gradient, shadow, or texture is NOT a flat margin band.
5. Estimate the product tight bounding-box occupancy as a 0.0-1.0 fraction.

A copied reference photograph may have perfect identity consistency.
Score identity and presentation independently. Never treat high identity
similarity as evidence that presentation is valid.

Use violation booleans conservatively but explicitly. Respond only with the
requested JSON object for both cutout and studio.

Respond with ONLY a JSON object (no markdown fence) of this exact shape:
{"cutout": {"identity": {"same_product": boolean, "consistency": number 0-1,
"has_artifact": boolean, "artifact_reason": string}, "presentation":
{"not_continuous_single_photo": boolean, "rectangular_boundary": boolean,
"planar_source_remnant": boolean, "flat_margin_band": boolean,
"tight_bbox_occupancy": number 0-1, "presentation_reason": string}},
"studio": {same shape as cutout}}`
