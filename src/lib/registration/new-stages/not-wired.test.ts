/**
 * 새 단계 모듈 경계 가드 — R10a: 모듈은 모델·등급을 코드에 박지 않는다(route로만 받는다).
 * R10: 모듈을 가져오는 곳은 연결 모듈(pdp-new-stages-stage — 새 배치 + newstages 잡만)·새 단계 route 표·JSONB 타입·그 시험뿐이다.
 * 파이프라인·이미지 단계·화면은 연결 모듈만 거친다. 새로 가져오는 곳이 생기면 이 허용 목록에 더하고 꺼진 잡 바이트를 다시 확인한다.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PDP_MODEL_ROUTES } from '../pdp-model-routes'
import { NEW_STAGE_ROUTE_NAMES } from './common'

const SRC = join(__dirname, '..', '..', '..')
const HERE = __dirname

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) return []
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return walk(path)
    return /\.(ts|tsx|js|mjs)$/.test(entry.name) ? [path] : []
  })
}

const moduleFiles = walk(HERE).filter((path) => !/\.(test|fixture)\.ts$/.test(path))

/**
 * new-stages 폴더를 가져오는 곳(이 폴더 밖) — 연결 모듈·route 표·JSONB 타입·연결 시험, 그리고 하네스 평가 도구(R11a — 첫 화면 심사 진입점과
 * 원장 요약, R11c — 사실 감사 단계 재현 진입점, 결정 카드 J07 — 설계 ① 있음/없음 카피 재현이 칸 카피 글(screen-lines)만 읽는다.
 * 파이프라인·화면 밖이라 꺼진 잡 바이트와 무관하다: k-line-run 꺼진 잡 지문·pdp-new-stages-pipeline 꺼진 잡 시험 그대로)
 */
const ALLOWED_IMPORTERS = [
  'lib/registration/pdp-model-routes.ts',
  'lib/registration/pdp-new-stages-stage.test.ts',
  'lib/registration/pdp-new-stages-stage.ts',
  'lib/registration/pdp-state.ts',
]

describe('새 단계 모듈 경계', () => {
  it('new-stages 폴더를 가져오는 곳은 허용 목록뿐이다(파이프라인·이미지 단계·화면은 연결 모듈만 거친다)', () => {
    const importers = walk(SRC)
      .filter((path) => !path.startsWith(HERE + sep))
      .filter((path) => /new-stages\//.test(readFileSync(path, 'utf8')))
      .map((path) => relative(SRC, path).split(sep).join('/'))
      .sort()
    expect(importers).toEqual(ALLOWED_IMPORTERS)
    // src 전체를 읽는다 — 넓은 vitest와 함께 돌면 5초 기본 제한을 넘는다
  }, 30_000)

  it('지금 route 표(PDP_MODEL_ROUTES)에 새 단계 이름이 없다', () => {
    for (const name of Object.values(NEW_STAGE_ROUTE_NAMES)) expect(Object.keys(PDP_MODEL_ROUTES)).not.toContain(name)
  })

  it('모듈 코드에 모델 이름·등급 값이 없다(route로만 받는다)', () => {
    expect(moduleFiles.length).toBeGreaterThanOrEqual(8)
    for (const path of moduleFiles) {
      const text = readFileSync(path, 'utf8')
      expect(text, relative(HERE, path)).not.toMatch(/\b(?:claude|gpt|gemini)-[\w.-]+/i)
      expect(text, relative(HERE, path)).not.toMatch(/\beffort\s*:\s*['"]/)
      expect(text, relative(HERE, path)).not.toMatch(/maxTokens\s*:\s*\d/)
    }
  })

  it('모듈은 공급자 호출을 끌어오지 않는다(callLlm은 부르는 쪽이 넘긴다)', () => {
    for (const path of moduleFiles) {
      const text = readFileSync(path, 'utf8')
      expect(text, relative(HERE, path)).not.toMatch(/^import (?!type )[^\n]*from '@\/lib\/agents\/llm[^']*'/m)
      expect(text, relative(HERE, path)).not.toMatch(/from '@\/lib\/agents\/_base'/)
    }
  })
})
