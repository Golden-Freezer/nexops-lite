/**
 * 템플릿 계산 칸 채우기 — 작성자는 모양(flow·slots·spacing·surfaces·fit·order)만 쓰고, 나머지는 흐름에서 계산한다.
 * 채우는 칸: signature, needs.facts, needs.photos, estimatedHeight, height, tokens, check(점수·사용 횟수는 보존), preview.
 * 전수 검사(lint.ts)가 같은 값을 대조하므로 손으로 고치면 검사에서 떨어진다. 순수·결정론.
 */

import { heightRange } from './sample'
import { deriveSignature } from './signature'
import { factRange, requiredPhotos } from './slots'
import type { Template } from './template-types'

export function fillMeta(t: Template): Template {
  const filled: Template = {
    ...t,
    version: t.version ?? 1,
    signature: deriveSignature(t),
    needs: { ...t.needs, evidence: t.needs?.evidence ?? [], photos: requiredPhotos(t), facts: factRange(t) },
    tokens: { color: 'concept', type: 'scene', radius: 'concept' },
    check: { stress: 1.2, lint: 'ci', avgScore: t.check?.avgScore ?? null, usedIn: t.check?.usedIn ?? 0 },
    preview: `mock/${t.id}.html`,
  }
  const { min, max, typical } = heightRange(filled)
  return { ...filled, estimatedHeight: { min, max }, height: typical }
}
