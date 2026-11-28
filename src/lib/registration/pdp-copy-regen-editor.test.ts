/**
 * 편집기 카피 재생성 반영(pdp-copy-regen-api, 통합 요구) — 길이 가드가 허용하는 가장 긴 후보를 넣어도 레이아웃 프리셋 유실 가드에서
 * 떨어지는 섹션이 없는지(guardDropped 0) R1 저장 잡 3건(P02·P03·P07)으로 고정한다.
 * ① 카피 칸을 후보로 바꿔 편집기 최초 빌드 → 적용 시도 수는 그대로, guardDropped 0
 * ② 최초 빌드 문서의 텍스트 요소를 후보로 바꾼 뒤(편집기 반영과 같다) 그 섹션 프리셋을 다시 적용 → 유실 가드 통과
 * 이미지 URL은 자리표시, 유료 호출 0.
 */

import { describe, expect, it } from 'vitest'
import { loadLayoutPresets } from './editor/data/layouts'
import type { DesignPalette } from './editor/types/editor'
import { applyLayoutPresetIfSafe } from './editor/utils/applyLayoutPreset'
import { R1_JOBS, renderR1, type R1Fixture } from './editor/utils/sectionConverter/__fixtures__/r1Render'
import { copyRegenLengthLimits, guardCopyCandidates } from './pdp-copy-regen-guard'

type Path = Array<string | number>
const FIELDS: Path[] = [
  ['mainIntro', 'hook'],
  ['mainIntro', 'benefitHeadline'],
  ['mainIntro', 'subBenefit'],
  ['pointCards', 0, 'title'],
  ['pointCards', 0, 'description'],
  ['solution', 'declaration'],
  ['solution', 'summary'],
]

function getAt(obj: unknown, path: Path): unknown {
  return path.reduce<unknown>((o, k) => (o as Record<string | number, unknown> | undefined)?.[k], obj)
}

function setAt(obj: unknown, path: Path, value: string): void {
  const parent = getAt(obj, path.slice(0, -1)) as Record<string | number, unknown>
  parent[path[path.length - 1]] = value
}

const FILL = '세척이쉬운넓은입구로바닥까지닿는솔을담았어요'

/** 길이 가드 상한을 꽉 채운 후보 — 줄 수·한 줄 글자 수·전체 글자 수(줄바꿈 포함) 모두 상한 안에서 가장 길게 */
function longestAllowed(current: string): string {
  const limits = copyRegenLengthLimits(current)
  const lines: string[] = []
  let used = 0
  let k = 0
  while (lines.length < limits.lines) {
    const room = limits.total - used - (lines.length > 0 ? 1 : 0)
    const n = Math.min(limits.lineChars, room)
    if (n <= 0) break
    let line = ''
    for (let i = 0; i < n; i++) line += FILL[k++ % FILL.length]
    used += n + (lines.length > 0 ? 1 : 0)
    lines.push(line)
  }
  return lines.join('\n')
}

function candidateFor(current: string): string {
  const candidate = longestAllowed(current)
  const guarded = guardCopyCandidates([candidate], {
    currentText: current,
    corpus: null,
    echoGuard: null,
    minAge: null,
  })
  expect(guarded.passed, current).toEqual([candidate])
  return candidate
}

function withField(f: R1Fixture, path: Path, value: string): R1Fixture {
  const copy = JSON.parse(JSON.stringify(f.copy)) as unknown
  setAt(copy, path, value)
  return { ...f, copy } as R1Fixture
}

describe('카피 재생성 반영 — R1 저장 잡 프리셋 유실 가드', () => {
  let reappliedTotal = 0
  for (const [key, f] of R1_JOBS) {
    it(`${key}: 카피 칸을 가장 긴 허용 후보로 바꿔 다시 빌드해도 guardDropped 0`, async () => {
      const base = await renderR1(f)
      expect(base.stats.layouts.guardDropped).toBe(0)
      expect(base.stats.layouts.tried).toBeGreaterThan(0)
      let checked = 0
      for (const path of FIELDS) {
        const current = getAt(f.copy, path)
        if (typeof current !== 'string' || !current.trim()) continue
        const { stats } = await renderR1(withField(f, path, candidateFor(current)))
        expect(stats.layouts.guardDropped, `${path.join('.')} ${JSON.stringify(stats.layouts)}`).toBe(0)
        expect(stats.layouts.tried, path.join('.')).toBe(base.stats.layouts.tried)
        checked++
      }
      expect(checked).toBeGreaterThanOrEqual(4)
    })

    // 최초 빌드 문서에 같은 프리셋을 다시 얹는 일은 텍스트와 무관하게 막히는 섹션이 있다(빌더 _01·테마·모바일 하한이 얹힌 hook 등).
    // 그래서 판정이 텍스트 교체로 바뀌지 않는지(통과하던 섹션은 계속 통과)를 본다
    it(`${key}: 편집기 문서의 텍스트 요소를 후보로 바꿔도 그 섹션 프리셋 재적용 판정이 바뀌지 않는다`, async () => {
      const { doc } = await renderR1(f)
      const palette = f.copy.designPalette as unknown as DesignPalette
      let replaced = 0
      let reapplied = 0
      for (const path of FIELDS) {
        const current = getAt(f.copy, path)
        if (typeof current !== 'string' || !current.trim()) continue
        const firstLine = current.split('\n')[0].trim()
        for (const section of doc.sections) {
          const target = section.elements.find((el) => el.textProps?.content.includes(firstLine))
          if (!target) continue
          const preset = (await loadLayoutPresets(section.sectionType)).find((p) => p.id === section.layoutId)
          if (!preset) continue
          const candidate = candidateFor(current)
          const edited = {
            ...section,
            elements: section.elements.map((el) =>
              el.id === target.id
                ? { ...el, textProps: { ...el.textProps!, content: candidate, richContent: undefined } }
                : el
            ),
          }
          const before = applyLayoutPresetIfSafe(section, preset, palette) !== null
          const after = applyLayoutPresetIfSafe(edited, preset, palette) !== null
          expect(after, `${path.join('.')} → ${section.sectionType}/${preset.id}`).toBe(before)
          replaced++
          if (after) reapplied++
        }
      }
      expect(replaced).toBeGreaterThanOrEqual(2)
      reappliedTotal += reapplied
    })
  }

  // 재적용이 통과하는 섹션(solution_guide layout_03 등)이 실제로 시험에 들었는지 — 잡마다 있지는 않아 합계로 본다
  it('세 잡 합계로 재적용이 통과하는 섹션의 교체를 2건 이상 확인했다', () => {
    expect(reappliedTotal).toBeGreaterThanOrEqual(2)
  })
})
