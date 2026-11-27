'use client'

/**
 * 상세페이지(PDP) 잡 결과 — final_html 미리보기(모바일 프레임 토글) + 섹션 이미지 그리드 +
 * 유사도 경고 배너(copy_sections.similarity_warnings) + 비용 + Canvas 에디터 진입(Phase 3).
 */

import { useState } from 'react'
import { Download, PenSquare, Smartphone, Rows3 } from 'lucide-react'
import { resolveGenerationTrack, stripStepFailurePrefix, type PdpJobRow } from '@/lib/registration/pdp-state'
import { PdpEditorPreview } from './PdpEditorPreview'

export function PdpPreview({ job }: { job: PdpJobRow }) {
  const [mobileFrame, setMobileFrame] = useState(true)
  const warnings = job.copy_sections.similarity_warnings ?? []
  const track = resolveGenerationTrack(job)
  const qualityReport = job.copy_sections.quality_report
  const ageCompliance = job.copy_sections.age_compliance

  return (
    <div className="space-y-4">
      {/* 완료 잡이라도 경고·폴백 사유(job.error)가 남아있을 수 있다 — 유사도 배너와 별개로 항상 노출(§6.4). */}
      {job.error && (
        <div className="rounded-lg border border-warning-500/30 bg-warning-50 px-3 py-2 text-xs text-warning-700">
          경고: {stripStepFailurePrefix(job.error)}
        </div>
      )}
      {warnings.length > 0 && (
        <div className="rounded-lg border border-warning-500/30 bg-warning-50 px-3 py-2 text-xs text-warning-700">
          유사도 게이트 경고 — 재생성 후에도 임계 초과: {warnings.map((w) => `${w.section}(${w.score.toFixed(2)})`).join(', ')}
        </div>
      )}
      {/* 연령 컴플라이언스 게이트 — 만 14세 이상 상품의 어린이 표현 잔여·고지 누락은 법적 리스크라 danger로 표시 */}
      {ageCompliance && (ageCompliance.violations.length > 0 || !ageCompliance.notice_present) && (
        <div className="rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-xs text-danger-700 space-y-1">
          <div>
            연령 제한(만 {ageCompliance.min_age}세 이상) 위반 가능 —{' '}
            {ageCompliance.violations.length > 0 && `어린이 표현 ${ageCompliance.violations.length}건 잔존`}
            {ageCompliance.violations.length > 0 && !ageCompliance.notice_present && ' · '}
            {!ageCompliance.notice_present && '연령 고지 문구 누락'}. 등록 전 에디터에서 수정하세요.
          </div>
          {ageCompliance.violations.slice(0, 5).map((v, i) => (
            <div key={`${v.section}-${i}`} className="text-danger-600">
              · [{v.section}] {v.sentence}
            </div>
          ))}
        </div>
      )}
      {/* Track I trust gate(결정 T-6) — 실측 신뢰요소 누락 경고 + 입력 보강 힌트(차단 아님) */}
      {qualityReport && qualityReport.trust_gate.missing_required.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 space-y-1">
          <div>
            실측 신뢰요소 누락 — 이 카테고리 베스트셀러의 필수 신뢰 스택 중 미생성:{' '}
            {qualityReport.trust_gate.missing_required.join(', ')}
          </div>
          {qualityReport.trust_gate.user_action_hints.map((hint) => (
            <div key={hint} className="text-amber-700">
              · {hint}
            </div>
          ))}
        </div>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-slate-700">미리보기</div>
          <button
            onClick={() => setMobileFrame((v) => !v)}
            className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50"
          >
            {mobileFrame ? <Rows3 className="w-3 h-3" /> : <Smartphone className="w-3 h-3" />}
            {mobileFrame ? '캔버스 원본(860px)' : '모바일 390px'}
          </button>
        </div>
        {job.final_html ? (
          // 에디터 실렌더 미리보기(2026-08-12) — 에디터와 동일한 문서·렌더러를 읽기 전용으로 표시.
          // 로드 실패 시 구 final_html iframe(캔버스 860 고정·동일 배율)로 폴백한다.
          // 390/860px 고정폭 프레임이 모바일 뷰포트를 뚫지 않도록 overflow-x-auto 래퍼로 감싼다 —
          // 화면보다 넓으면 페이지 전체가 아니라 이 박스 안에서만 가로 스크롤된다.
          <div className="w-full max-w-full overflow-x-auto">
            <PdpEditorPreview
              jobId={job.id}
              displayWidth={mobileFrame ? 390 : 860}
              fallback={
                mobileFrame ? (
                  <div className="mx-auto w-[390px] h-[900px] overflow-hidden border border-slate-200 rounded">
                    <iframe
                      srcDoc={job.final_html}
                      sandbox="allow-same-origin"
                      title="상세페이지 미리보기 (모바일 배율)"
                      style={{
                        width: 860,
                        height: 900 / (390 / 860),
                        transform: `scale(${390 / 860})`,
                        transformOrigin: 'top left',
                        border: 0,
                      }}
                    />
                  </div>
                ) : (
                  <iframe
                    srcDoc={job.final_html}
                    sandbox="allow-same-origin"
                    title="상세페이지 미리보기"
                    className="w-full border border-slate-200 rounded"
                    style={{ height: 900 }}
                  />
                )
              }
            />
          </div>
        ) : (
          <div className="text-xs text-slate-400">합성된 HTML이 없습니다.</div>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
        <div className="text-sm font-semibold text-slate-700">섹션 이미지 ({job.section_images.length})</div>
        {job.section_images.length === 0 ? (
          <div className="text-xs text-slate-400">생성된 섹션 이미지가 없습니다.</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {job.section_images.map((img, i) => (
              <div key={`${img.section}-${i}`} className="rounded-lg border border-slate-200 p-2 space-y-1.5">
                <div className="text-[11px] font-medium text-slate-600 truncate">{img.section}</div>
                {img.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={img.url} alt={img.section} className="w-full aspect-square object-cover rounded" />
                ) : (
                  <div className="w-full aspect-square rounded bg-slate-50 flex items-center justify-center text-[11px] text-danger-600 p-2 text-center">
                    {img.error ?? '생성 실패'}
                  </div>
                )}
                {img.url && (
                  <a
                    href={img.url}
                    target="_blank"
                    rel="noreferrer"
                    download
                    className="inline-flex items-center gap-0.5 text-[11px] px-2 py-1 rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50"
                  >
                    <Download className="w-3 h-3" /> 원본
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="flex items-center justify-between text-[11px] text-slate-400">
        <span className="inline-flex items-center gap-1.5">
          비용 ${job.cost_usd.toFixed(3)} · 모델 {job.image_model} ({job.image_quality}) · 모드 {job.mode}
          {/* 트랙 배지(결정 T-1) — 내재화=Emerald(NEXOPS 세컨더리), 표준=slate */}
          <span
            className={`px-1.5 py-0.5 rounded-full border text-[10px] ${
              track === 'internalized'
                ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                : 'border-slate-200 bg-slate-50 text-slate-500'
            }`}
          >
            {track === 'internalized' ? '실측 내재화 β' : '표준'}
          </span>
        </span>
        <a
          href={`/registration/detail-page/${job.id}/editor`}
          className="inline-flex items-center gap-1 text-[11px] px-3 py-1.5 rounded-full border border-accent-500 text-accent-600 hover:bg-accent-50 transition-colors"
        >
          <PenSquare className="w-3 h-3" /> 에디터로 열기
        </a>
      </div>
    </div>
  )
}
