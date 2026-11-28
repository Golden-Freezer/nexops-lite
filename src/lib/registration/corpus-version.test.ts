import { describe, expect, it, vi } from 'vitest'

vi.mock('./corpus/fashion.json', () => ({
  default: {
    category: 'fashion',
    generatedAt: '2026-08-20',
    contentHash: 'abc123def456',
  },
}))

vi.mock('./corpus/v2/fashion.json', () => ({
  default: {
    category: 'fashion',
    generatedAt: '2026-08-20',
    schemaVersion: 2,
    contentHash: 'fed654cba321',
  },
}))

import { getCorpusVersion as getCorpusVersionV1 } from './corpus'
import { getCorpusVersion as getCorpusVersionV2 } from './corpus-v2'

describe('getCorpusVersion 정식 지문', () => {
  it('v1 contentHash가 있으면 legacy 대신 정식 지문을 반환한다', () => {
    expect(getCorpusVersionV1('fashion')).toBe('v1:2026-08-20:abc123def456')
  })

  it('v2 contentHash가 있으면 schemaVersion을 포함한 정식 지문을 반환한다', () => {
    expect(getCorpusVersionV2('fashion')).toBe('2:2026-08-20:fed654cba321')
  })
})
