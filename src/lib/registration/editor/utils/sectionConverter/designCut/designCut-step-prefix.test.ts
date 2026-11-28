/**
 * T5 단계 제목 번호 접두(적용 D5 P1, 통합 11-03 15:1x) — 번호 원 옆 제목 맨 앞의 'N. '·'N) '(뒤에 띄어쓰기)만 뗀다.
 * R17-L P02 저장 카피가 '1. 간식 고르기'처럼 접두를 달고 와 바로 앞 번호 원 '1'과 번호를 되풀이했다.
 * '1.5L …'·'1회용 …'·'3단계 …'처럼 숫자로 시작하는 제목, 단계 설명, 번호 원 옆이 아닌 글(T5 머리 제목)은 그대로다.
 */
import { describe, expect, it } from 'vitest'
import { assembleEditorDataResponse } from '@/lib/registration/editor-data'
import { buildEditorDocument } from '@/lib/registration/editor/utils/buildEditorDocument'
import type { CanvasSection } from '@/lib/registration/editor/types/canvas'
import { designCutJobB, designCutPlanForB } from './designCut.fixture'
import { stepTitleOf } from './templatesInfo'

describe('stepTitleOf — 번호 원 옆 단계 제목', () => {
  it("'N. '·'N) '·두 자리 번호·앞 공백 접두를 뗀다", () => {
    expect(stepTitleOf('1. 간식 고르기')).toBe('간식 고르기')
    expect(stepTitleOf('2) 그릇에 담기')).toBe('그릇에 담기')
    expect(stepTitleOf('10. 마무리')).toBe('마무리')
    expect(stepTitleOf(' 3.  물 붓기')).toBe('물 붓기')
  })

  it("숫자로 시작하는 제목·띄어쓰기 없는 접두는 그대로 — '1.5L'·'1회용'·'3단계'·'1)붙이기'", () => {
    for (const title of ['1.5L 물통 채우기', '1회용 봉투에 담기', '3단계로 접기', '1)붙이기', '20개 한 번에 담기', '2.5cm 간격으로'])
      expect(stepTitleOf(title)).toBe(title)
  })

  it('떼고 남는 글이 없으면 원래 제목, 비어 있으면 null', () => {
    expect(stepTitleOf('1. ')).toBe('1. ')
    expect(stepTitleOf('')).toBeNull()
    expect(stepTitleOf(null)).toBeNull()
    expect(stepTitleOf(undefined)).toBeNull()
  })
})

const STEPS = [
  { title: '1. 간식 고르기', description: '1. 설명 앞 번호는 그대로' },
  { title: '2) 그릇에 담기', description: '그릇 가운데에 담아요' },
  { title: '1.5L 물통 채우기', description: '물을 채워요' },
  { title: '3단계로 접기', description: '접어서 보관해요' },
]

async function docWith(steps: typeof STEPS, headline?: string): Promise<CanvasSection[]> {
  const plan = designCutPlanForB()
  const howto = plan.sections.find((s: { key: string }) => s.key === 'hidden_page')!
  ;(howto as unknown as { modules: unknown[] }).modules = [{ type: 'M7', data: { steps } }]
  if (headline) Object.assign(howto.text, { headline })
  const job = designCutJobB({ plan })
  return (await buildEditorDocument(job.id, assembleEditorDataResponse(job, null))).sections
}
const texts = (sections: CanvasSection[], prefix: string) =>
  sections.flatMap((s) => s.elements.filter((e) => e.name.startsWith(prefix)).map((e) => e.textProps?.content))

describe('T5 편집기 문서 — 번호 원 옆 제목만 바뀐다', () => {
  it('제목 접두만 떼고 번호 원·설명은 그대로', async () => {
    const sections = await docWith(STEPS)
    expect(texts(sections, 'designcut-step-number-')).toEqual(['1', '2', '3', '4'])
    expect(texts(sections, 'designcut-step-title-')).toEqual(['간식 고르기', '그릇에 담기', '1.5L 물통 채우기', '3단계로 접기'])
    expect(texts(sections, 'designcut-step-desc-')).toEqual(STEPS.map((s) => s.description))
  })

  it("번호 원 옆이 아닌 글은 'N. '로 시작해도 그대로(T5 머리 제목)", async () => {
    const sections = await docWith(STEPS, '1. 이렇게 써요')
    const head = sections.filter((s) => s.layoutId === 'designcut_T5').flatMap((s) => s.elements.filter((e) => e.name === 'designcut-headline'))
    expect(head.map((e) => e.textProps?.content)).toEqual(['1. 이렇게 써요'])
  })

  it('접두 없는 저장 계획(고정물 B)은 단계 제목이 계획 글 그대로', async () => {
    const plan = designCutPlanForB()
    const howto = plan.sections.find((s: { key: string }) => s.key === 'hidden_page') as unknown as { modules: Array<{ data: { steps: Array<{ title: string }> } }> }
    const want = howto.modules[0].data.steps.map((s) => s.title)
    const job = designCutJobB({ plan })
    const sections = (await buildEditorDocument(job.id, assembleEditorDataResponse(job, null))).sections
    expect(texts(sections, 'designcut-step-title-')).toEqual(want)
  })
})
