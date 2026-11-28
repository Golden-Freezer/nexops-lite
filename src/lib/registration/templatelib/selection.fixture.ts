/**
 * K 라인 선택 규칙 시험용 가짜 템플릿 — 선택 규칙이 읽는 칸만 채운다.
 */

import type { DesigncutBg } from '../pdp-state'
import type { MetaSlot, TemplateMeta, TemplateZone } from './template-meta'

export interface TplOptions {
  section: string
  zone: TemplateZone
  photos: number
  evidence: string[]
  concepts: string[]
  density: TemplateMeta['fit']['density']
  block: string[]
  avg: number | null
  used: number
  shape: string
  notNextTo: string[]
  height: number
  surfaces: DesigncutBg[]
  /** 카피 사실 수 [최소, 최대] — 필수·선택 글자 슬롯으로 만든다 */
  facts: [number, number]
  /** 사진 슬롯 하나의 구도 */
  shots: string[]
  slots: Record<string, MetaSlot>
  /** 머리 구조(point_div) */
  head: string
  /** 카테고리 템플릿 칸 */
  categories: string[]
  productFamilies: string[]
  family: string
}

export function tpl(id: string, opts: Partial<TplOptions> = {}): TemplateMeta {
  const [min, max] = opts.facts ?? [0, 0]
  return {
    id,
    section: opts.section ?? id.split('.')[0],
    name: id,
    surfaces: opts.surfaces ?? ['W', 'T', 'N', 'D'],
    slots: opts.slots ?? {
      must: { type: 'text', required: true, source: 'copy', facts: min },
      extra: { type: 'text', required: false, source: 'copy', facts: max - min },
      ...(opts.shots ? { photo: { type: 'image' as const, required: true, purpose: ['scene'], composition: opts.shots } } : {}),
    },
    signature: { columns: 1, photo: opts.shape ?? id, align: 'left', container: 'none' },
    needs: { photos: opts.photos ?? 0, evidence: opts.evidence ?? [] },
    height: opts.height ?? 1500,
    ...(opts.head ? { headStyle: opts.head } : {}),
    ...(opts.family ? { family: opts.family } : {}),
    fit: {
      concepts: opts.concepts ?? [],
      density: opts.density ?? 'high',
      categoryBlock: opts.block ?? [],
      ...(opts.categories ? { categories: opts.categories } : {}),
      ...(opts.productFamilies ? { productFamilies: opts.productFamilies } : {}),
    },
    order: { zone: opts.zone ?? 'value', notNextTo: opts.notNextTo ?? [] },
    check: { avgScore: opts.avg ?? null, usedIn: opts.used ?? 0 },
  }
}

export const one = (section: string, ...candidates: TemplateMeta[]) => ({ section, candidates })
