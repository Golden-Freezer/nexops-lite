import { describe, expect, it } from 'vitest'
import { parseLlmJson } from '../json-parser'
import { escapeRawControlsInStrings, parseRegistrationJson } from './llm-json'

// 실측 모양(2026-10-27 design-prompt): 코드 블록 안 JSON, 문자열 값에 템플릿 여러 줄 블록이 날 줄바꿈째 들어 있다
const RAW_NEWLINE_RESPONSE = [
  '```json',
  '{',
  '    "section_image_prompts": {',
  '        "hero": {',
  '            "positive": "Studio shot. No text anywhere.',
  'PRODUCT CONSISTENCY RULES (ABSOLUTE):',
  '1. SHAPE: Match the reference.\t2. COLOR: same.",',
  '            "negative": "text, \\"logo\\", watermark"',
  '        }',
  '    },',
  '    "composition_notes": "clean"',
  '}',
  '```',
].join('\n')

describe('escapeRawControlsInStrings', () => {
  it('문자열 안의 날 줄바꿈·탭만 이스케이프하고 문자열 밖 줄바꿈은 그대로 둔다', () => {
    const fixed = escapeRawControlsInStrings('{\n  "a": "x\ny\tz",\n  "b": 1\n}')
    expect(fixed).toBe('{\n  "a": "x\\ny\\tz",\n  "b": 1\n}')
    expect(JSON.parse(fixed)).toEqual({ a: 'x\ny\tz', b: 1 })
  })

  it('이스케이프된 따옴표를 문자열 끝으로 읽지 않는다', () => {
    const fixed = escapeRawControlsInStrings('{"a": "say \\"hi\\"\nnow"}')
    expect(JSON.parse(fixed)).toEqual({ a: 'say "hi"\nnow' })
  })
})

describe('parseRegistrationJson', () => {
  it('공용 파서가 받지 못하는 실측 모양을 읽는다', () => {
    expect(parseLlmJson(RAW_NEWLINE_RESPONSE)).toBeNull()
    const parsed = parseRegistrationJson(RAW_NEWLINE_RESPONSE)
    expect(Object.keys(parsed ?? {})).toEqual(['section_image_prompts', 'composition_notes'])
    const hero = (parsed?.section_image_prompts as Record<string, Record<string, string>>).hero
    expect(hero.positive).toContain('PRODUCT CONSISTENCY RULES (ABSOLUTE):\n1. SHAPE')
    expect(hero.negative).toBe('text, "logo", watermark')
  })

  it('공용 파서가 읽는 응답은 결과가 같다', () => {
    const text = '```json\n{"a": [1, 2,], "b": "c"}\n```'
    expect(parseRegistrationJson(text)).toEqual(parseLlmJson(text))
  })

  it('잘린 응답은 여전히 null이다(상한 단계 올림으로 넘긴다)', () => {
    expect(parseRegistrationJson('{"a": "unterminated\nvalue')).toBeNull()
  })
})
