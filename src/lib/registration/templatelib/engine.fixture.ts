/** 엔진·검사기 시험용 템플릿 — 실제 라이브러리가 아니다 */

import { SAMPLE_COLORS, sampleContext } from './sample'
import type { ImageSlot, Template, TextSlot } from './template-types'

export const COLORS = SAMPLE_COLORS
export const ctxOf = sampleContext

export const textSlot = (over: Partial<TextSlot> = {}): TextSlot => ({
  type: 'text',
  required: false,
  source: 'copy',
  facts: 1,
  maxChars: 40,
  maxLines: 3,
  claimRisk: 'none',
  ...over,
})

export const imageSlot = (over: Partial<ImageSlot> = {}): ImageSlot => ({
  type: 'image',
  required: false,
  purpose: ['feature_proof'],
  composition: ['front'],
  aspect: ['3:4'],
  minHeight: 500,
  ...over,
})

export const templateOf = (over: Partial<Template>): Template => ({
  id: 'sub_div.fixture',
  section: 'sub_div',
  name: '시험',
  version: 1,
  surfaces: ['W', 'N', 'D'],
  flow: [],
  slots: {},
  spacing: { top: 120, titleGap: 48, photoGap: 88, bottom: 120 },
  signature: { columns: 1, photo: 'inset', align: 'left', container: 'none' },
  needs: { photos: 0, evidence: [], facts: { min: 0, max: 0 } },
  estimatedHeight: { min: 0, max: 0 },
  height: 0,
  fit: { concepts: ['clean-trust'], density: 'mid', personaTags: ['시험'], categoryBlock: [] },
  order: { zone: 'value', notNextTo: [] },
  tokens: { color: 'concept', type: 'scene', radius: 'concept' },
  check: { stress: 1.2, lint: 'ci', avgScore: null, usedIn: 0 },
  preview: 'mock/sub_div.fixture.html',
  ...over,
})
