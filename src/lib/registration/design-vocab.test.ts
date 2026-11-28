import { describe, expect, it, vi } from 'vitest'
import {
  getDesignVocab,
  getVocabHash,
  lookupRoleVocab,
  lookupVocabCell,
  validateDesignVocab,
  type DesignVocabSnapshot,
  type RoleVocab,
  type VocabCell,
} from './design-vocab'

function role(sections = 40): RoleVocab {
  const share = [{ key: 'split_lr', share: 0.5 }]
  return {
    sections,
    prevalence: 0.5,
    positionDist: { opening: 0.2, early: 0.2, middle: 0.2, late: 0.2, closing: 0.2 },
    layout: share,
    background: share,
    elements: share,
    copyDevices: share,
    overlay: { imageShare: 0.3, devices: share },
    shot: { angle: share, composition: share, lighting: share, staging: share, backdrop: share },
  }
}

function cell(roles: VocabCell['roles'], sectionCountMedian = 12): VocabCell {
  return { pages: 50, sectionCountMedian, roles }
}

function snapshot(): DesignVocabSnapshot {
  return {
    schemaVersion: 1,
    generatedAt: '2026-10-27T00:00:00.000Z',
    derivedFingerprint: 'abcdef012345',
    contentHash: '0123456789ab',
    taxonomyVersion: 'v1',
    coverage: { layout: 0.99 },
    platforms: {
      coupang: {
        pages: 400,
        pooled: cell({ hook: role(), usp_feature: role() }, 20),
        byCategory: { beauty: cell({ usp_feature: role() }, 18) },
        tierLevers: [],
      },
      naver: {
        pages: 900,
        pooled: cell({ hook: role(), faq: role() }, 16),
        byCategory: { beauty: cell({ hook: role() }, 15), digital: cell({ usp_feature: role() }, 14) },
        tierLevers: [],
      },
    },
  }
}

describe('validateDesignVocab', () => {
  it('정상 스냅샷을 통과시킨다', () => {
    expect(validateDesignVocab(snapshot()).ok).toBe(true)
  })

  it.each([
    ['schemaVersion', (s: Record<string, unknown>) => ({ ...s, schemaVersion: 2 })],
    ['platforms 없음', (s: Record<string, unknown>) => ({ ...s, platforms: undefined })],
    ['naver 없음', (s: DesignVocabSnapshot) => ({ ...s, platforms: { coupang: s.platforms.coupang } })],
  ])('%s → 실패', (_name, mutate) => {
    expect(validateDesignVocab(mutate(snapshot() as never)).ok).toBe(false)
  })

  it('비율 범위·역할 키·구간 위반을 잡는다', () => {
    const badShare = snapshot()
    badShare.platforms.coupang.pooled.roles.hook!.layout = [{ key: 'split_lr', share: 1.5 }]
    expect(validateDesignVocab(badShare)).toMatchObject({ ok: false })

    const badRole = snapshot() as unknown as { platforms: { naver: { pooled: { roles: Record<string, unknown> } } } }
    badRole.platforms.naver.pooled.roles.unknown_role = role()
    expect(validateDesignVocab(badRole)).toMatchObject({ ok: false, reason: expect.stringContaining('unknown_role') })

    const badPosition = snapshot()
    delete (badPosition.platforms.coupang.byCategory.beauty.roles.usp_feature!.positionDist as Partial<Record<string, number>>).closing
    expect(validateDesignVocab(badPosition).ok).toBe(false)
  })
})

describe('조회 순서 — 쿠팡 카테고리 → 네이버 카테고리 → 쿠팡 pooled → 네이버 pooled', () => {
  const vocab = snapshot()

  it('셀 조회', () => {
    expect(lookupVocabCell('beauty', vocab)?.priorSource).toBe('coupang:beauty')
    expect(lookupVocabCell('Digital', vocab)?.priorSource).toBe('naver:digital')
    expect(lookupVocabCell('household', vocab)?.priorSource).toBe('coupang:pooled')
    expect(lookupVocabCell(null, vocab)?.priorSource).toBe('coupang:pooled')
    expect(lookupVocabCell('beauty', vocab)?.cell.sectionCountMedian).toBe(18)
  })

  it('역할이 없는 카테고리 셀(표본 부족)은 건너뛴다', () => {
    const withEmpty = snapshot()
    withEmpty.platforms.coupang.byCategory.household = cell({}, 15)
    expect(lookupVocabCell('household', withEmpty)?.priorSource).toBe('coupang:pooled')
  })

  it('stationery·packaging·pet은 항상 pooled', () => {
    const withStationery = snapshot()
    withStationery.platforms.coupang.byCategory.stationery = cell({ usp_feature: role() })
    for (const category of ['stationery', 'packaging', 'pet']) {
      expect(lookupVocabCell(category, withStationery)?.priorSource).toBe('coupang:pooled')
    }
  })

  it('역할 조회는 셀에 역할이 없으면 다음 순서로 넘어간다', () => {
    expect(lookupRoleVocab('beauty', 'usp_feature', vocab)?.priorSource).toBe('coupang:beauty')
    expect(lookupRoleVocab('beauty', 'hook', vocab)?.priorSource).toBe('naver:beauty')
    expect(lookupRoleVocab('digital', 'hook', vocab)?.priorSource).toBe('coupang:pooled')
    expect(lookupRoleVocab('digital', 'faq', vocab)?.priorSource).toBe('naver:pooled')
    expect(lookupRoleVocab('digital', 'legal_notice', vocab)).toBeNull()
  })

  it('스냅샷이 없으면 null', () => {
    expect(lookupVocabCell('beauty', null)).toBeNull()
    expect(lookupRoleVocab('beauty', 'hook', null)).toBeNull()
    expect(getVocabHash(null)).toBeNull()
  })
})

describe('정적 스냅샷(corpus/design-vocab.json)', () => {
  it('검증을 통과하고 T2가 쓰는 필드를 갖는다', () => {
    const vocab = getDesignVocab()
    expect(vocab).not.toBeNull()
    expect(getVocabHash(vocab)).toMatch(/^[0-9a-f]{12}$/)
    for (const platform of ['coupang', 'naver'] as const) {
      const pooled = vocab!.platforms[platform].pooled
      expect(pooled.sectionCountMedian).toBeGreaterThan(0)
      expect(pooled.roles.usp_feature?.prevalence).toBeGreaterThan(0)
      expect(Object.values(pooled.roles).every((r) => r!.sections >= 30)).toBe(true)
    }
  })

  it('검증 실패 시 null과 경고(1회)', async () => {
    vi.resetModules()
    vi.doMock('./corpus/design-vocab.json', () => ({ default: { schemaVersion: 0 } }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const mod = await import('./design-vocab')
    expect(mod.getDesignVocab()).toBeNull()
    expect(mod.getDesignVocab()).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
    vi.doUnmock('./corpus/design-vocab.json')
    vi.resetModules()
  })
})
