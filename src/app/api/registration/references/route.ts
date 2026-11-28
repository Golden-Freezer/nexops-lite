// POST /api/registration/references — 레퍼런스(기존 상세페이지 긴 캡처·PDF) 분석. 오너 조건(2026-10-30): 레퍼런스 분석용으로만.
// 입력(FormData, 'kind' = own(자사 기존 페이지) | competitor | other) — 둘 중 하나:
//   ① 띠: 'strips'(화면이 폭 860으로 줄인 JPEG 1~16장) + 'positions'(JSON [{start,end}]) + 'fileName' (+ 'sampled'=1) — 생성 화면이 쓴다
//   ② 파일: 'file'(PNG·JPEG·WebP 긴 캡처·PDF 각 4MB, PDF 30쪽) — 서버가 띠로 자른다(로컬·하네스)
// 4MB = Vercel 함수 요청 본문 상한(약 4.5MB) 안 — 큰 캡처는 화면이 띠 JPEG로 줄여 보낸다(reference-browser).
//   → 200 { reference: ReferenceInput }. 파일·이미지는 저장하지 않는다(스토리지 미사용). 화면이 결과를 잡 생성 입력
//   spec_sheet.referenceInputs(3개 이하)에 넣는다. 분석 산출은 리서치 블록으로만, 받아쓴 원문은 재현 가드·유사도 검사로만 쓴다.
// 오너 전용. 잡을 읽거나 쓰지 않는다(잡 생성 전 입력) — 결과는 요청한 오너에게만 돌려주고, 사용 기록(ai_usage_log)은 그 user_id로 남는다.
// 막히면: 400 입력 오류(형식·크기·쪽 수·폭·띠 위치), 409 { code: 'budget' } 월 예산, 502 모델 호출·파싱 실패.

import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/auth/clerk'
import { checkMonthlyBudget } from '@/lib/agents/budget'
import { analyzeReferencePdf, analyzeReferenceStrips, REFERENCE_AGENT } from '@/lib/agents/registration/pdp-reference-agent'
import { pdpRoute } from '@/lib/registration/pdp-model-routes'
import { mergeReferenceBatches } from '@/lib/registration/references/reference-insights'
import {
  inspectPdf,
  sliceReferenceImage,
  sniffReferenceType,
  type ReferenceStrip,
} from '@/lib/registration/references/reference-strips'
import { readStripUpload } from '@/lib/registration/references/reference-upload'
import {
  REFERENCE_KINDS,
  REFERENCE_LIMITS,
  type ReferenceInput,
  type ReferenceKind,
} from '@/lib/registration/references/reference-types'

export const dynamic = 'force-dynamic'
// 띠 16장 = 2콜 × 시간 제한 90초 × 재시도 1회
export const maxDuration = 300

const MB = 1024 * 1024
const isKind = (v: unknown): v is ReferenceKind => typeof v === 'string' && (REFERENCE_KINDS as readonly string[]).includes(v)
const bad = (error: string) => NextResponse.json({ error }, { status: 400 })

function cleanName(name: unknown): string {
  const base = (typeof name === 'string' ? name : '').split(/[\\/]/).pop() ?? ''
  return base.replace(/[\u0000-\u001f]/g, '').trim().slice(0, REFERENCE_LIMITS.fileNameMaxChars) || 'reference'
}

type Prepared =
  | { source: 'image'; fileName: string; strips: ReferenceStrip[]; warnings: string[] }
  | { source: 'pdf'; fileName: string; pdfBase64: string; pages: number | null; warnings: string[] }

/** 입력 → 분석할 띠·PDF. 틀리면 거절 문구 */
async function prepare(form: FormData): Promise<Prepared | { error: string }> {
  const sampledNote = (n: number) => `캡처가 길어 ${n}개 구간만 골라 읽었습니다.`
  const stripUpload = await readStripUpload(form)
  if (stripUpload && 'error' in stripUpload) return stripUpload
  if (stripUpload) {
    const warnings = form.get('sampled') === '1' ? [sampledNote(stripUpload.strips.length)] : []
    return { source: 'image', fileName: cleanName(form.get('fileName')), strips: stripUpload.strips, warnings }
  }
  const file = form.get('file')
  if (!(file instanceof File)) return { error: '파일이 필요합니다.' }
  const bytes = new Uint8Array(await file.arrayBuffer())
  const type = sniffReferenceType(bytes)
  if (!type) return { error: 'PNG·JPEG·WebP 캡처나 PDF만 받습니다.' }
  const maxBytes = type === 'pdf' ? REFERENCE_LIMITS.pdfMaxBytes : REFERENCE_LIMITS.imageMaxBytes
  if (bytes.byteLength > maxBytes) {
    return { error: `파일이 너무 큽니다(${type === 'pdf' ? 'PDF' : '캡처'} 최대 ${maxBytes / MB}MB — 서버 요청 상한).` }
  }
  if (type === 'pdf') {
    const pdf = inspectPdf(bytes)
    if ('error' in pdf) return pdf
    if (pdf.pages !== null && pdf.pages > REFERENCE_LIMITS.pdfMaxPages) {
      return {
        error: `PDF 쪽 수가 너무 많습니다(${pdf.pages}쪽 — 최대 ${REFERENCE_LIMITS.pdfMaxPages}쪽). 필요한 쪽만 남겨 다시 올려 주세요.`,
      }
    }
    const warnings = pdf.pages === null ? ['PDF 쪽 수를 확인하지 못했습니다.'] : []
    return { source: 'pdf', fileName: cleanName(file.name), pdfBase64: Buffer.from(bytes).toString('base64'), pages: pdf.pages, warnings }
  }
  const sliced = await sliceReferenceImage(bytes)
  if ('error' in sliced) return sliced
  const warnings = sliced.sampled ? [sampledNote(sliced.strips.length)] : []
  return { source: 'image', fileName: cleanName(file.name), strips: sliced.strips, warnings }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await requireOwner()
    // 본문을 다 읽기 전에 선언된 크기로 먼저 거른다(폼 경계 몫 64KB 여유)
    const declared = Number(req.headers.get('content-length') ?? 0)
    if (declared > REFERENCE_LIMITS.imageMaxBytes + 64 * 1024) {
      return bad(`파일이 너무 큽니다(최대 ${REFERENCE_LIMITS.imageMaxBytes / MB}MB — 서버 요청 상한). 긴 캡처는 줄여서, PDF는 필요한 쪽만 남겨 올려 주세요.`)
    }
    const form = await req.formData()
    const kind = form.get('kind')
    if (!isKind(kind)) return bad('kind는 own·competitor·other 중 하나여야 합니다.')
    const prepared = await prepare(form)
    if ('error' in prepared) return bad(prepared.error)

    const route = pdpRoute('analysis/reference')
    const budget = await checkMonthlyBudget(REFERENCE_AGENT, route.model)
    if (budget.degraded) {
      return NextResponse.json(
        { error: '월 AI 예산 지출을 읽지 못해 지금은 분석할 수 없습니다. 잠시 뒤 다시 시도해 주세요.', code: 'budget' },
        { status: 409 }
      )
    }
    if (!budget.allowed) {
      return NextResponse.json(
        { error: `월 AI 예산 한도 — 당월 지출 $${budget.spentUsd.toFixed(2)} / $${budget.budgetUsd}`, code: 'budget' },
        { status: 409 }
      )
    }

    const runContext = { userId, stage: REFERENCE_AGENT }
    const result =
      prepared.source === 'image'
        ? await analyzeReferenceStrips(prepared.strips, runContext)
        : await analyzeReferencePdf(prepared.pdfBase64, prepared.pages, runContext)
    if (!result.success && result.error.stage === 'budget') {
      return NextResponse.json({ error: result.error.message, code: 'budget' }, { status: 409 })
    }
    if (!result.success) {
      return NextResponse.json(
        { error: `레퍼런스 분석에 실패했습니다: ${result.error.message}`, costUsd: result.usage.cost },
        { status: 502 }
      )
    }

    const merged = mergeReferenceBatches(result.data)
    const warnings = [...prepared.warnings]
    if (merged.dropped > 0) warnings.push(`원문을 그대로 옮긴 분석 항목 ${merged.dropped}개를 뺐습니다.`)
    const reference: ReferenceInput = {
      id: randomUUID(),
      kind,
      fileName: prepared.fileName,
      source: prepared.source,
      units: prepared.source === 'image' ? prepared.strips.length : (prepared.pages ?? 0),
      insights: merged.insights,
      transcript: merged.transcript,
      costUsd: result.usage.cost,
      analyzedAt: new Date().toISOString(),
      warnings,
    }
    return NextResponse.json({ reference })
  } catch (error: unknown) {
    if (error instanceof NextResponse) return error
    const message = error instanceof Error ? error.message : '서버 오류'
    console.error('registration references POST error:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
