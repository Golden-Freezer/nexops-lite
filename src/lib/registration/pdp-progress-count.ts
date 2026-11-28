/**
 * 진행 화면(PdpProgress) 이미지 단계의 '섹션 이미지 N / M장' 수 — 화면 표시만, 파이프라인은 읽지 않는다.
 * K 라인(templatelib) 잡은 컷이 계획 기록(section_plan.templatelib.shots)과 대표 컷에서 나오는데, 분모가 D 설계 콜 프롬프트 수
 * (design_prompts.section_image_prompts)라 운영 첫 K 잡 P08이 '23 / 8장'으로 보였다(세션 B 11-06). K 잡은 대표 컷 + 계획 컷으로 세고,
 * 분자도 그 컷만 센다. 계획 컷 기록이 없는 잡(D·R)은 지금 그대로다.
 * 클라이언트 번들에 들어가므로 templatelib 모듈을 끌어오지 않는다(대표 컷 키는 section-values HERO_SHOT_KEY와 같은 값).
 */
import type { PdpJobRow } from './pdp-state'

const HERO_KEY = 'hero'

export interface SectionImageProgress {
  generated: number
  expected: number
}

export function sectionImageProgress(job: Pick<PdpJobRow, 'design_prompts' | 'section_plan' | 'section_images'>): SectionImageProgress {
  const shots = job.section_plan?.templatelib?.shots
  if (shots && shots.length > 0) {
    const planned = new Set([HERO_KEY, ...shots.map((shot) => shot.key)])
    return { generated: job.section_images.filter((entry) => planned.has(entry.section)).length, expected: planned.size }
  }
  return { generated: job.section_images.length, expected: Object.keys(job.design_prompts?.section_image_prompts ?? {}).length }
}
