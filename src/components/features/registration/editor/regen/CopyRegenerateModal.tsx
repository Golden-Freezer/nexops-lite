'use client';

// editor/regen/CopyRegenerateModal.tsx — 글자 하나 'AI 카피 다시 쓰기'(묶음 5 카피, NEXFIT 카피 재생성 이식·축소).
// 확인 전에 사전 조회(쓰기 없음)로 비용 상한과 막힌 사유를 보여 준다. 프롬프트는 바꾸지 못한다 — 어조 3종과 짧은 요청만 서버가 붙인다.
// 서버가 즉시 처리해 가드를 통과한 후보(최대 3개)를 돌려주면 하나를 골라 넣는다. 걸러지거나 실패하면 이전 카피를 그대로 둔다.
// 처리 중(최대 약 60초)에는 같은 잡의 다른 요청이 409 busy라 버튼을 막는다.

import { useEffect, useRef, useState } from 'react';
import { Loader2, Sparkles, X } from 'lucide-react';
import { COPY_REGEN_NOTE_MAX_CHARS, type CopyRegenPreviewResponse, type CopyRegenTone } from '@/lib/registration/pdp-copy-regen';
import { CopyRegenApiError, copyRegenApi } from '@/lib/registration/editor/services/copyRegenApi';
import {
  COPY_REGEN_TONE_LABELS,
  COPY_REGEN_TONE_ORDER,
  copyRegenBlockText,
  copyRegenBody,
  copyRegenCostLines,
  copyRegenOutcome,
  formatUsd,
  type CopyRegenOutcome,
  type CopyRegenTarget,
} from '@/lib/registration/editor/utils/copyRegenTarget';

interface CopyRegenerateModalProps {
  jobId: string;
  target: CopyRegenTarget;
  onClose: () => void;
  /** 고른 후보를 캔버스 요소에 넣는다. 요소가 없어졌으면 false */
  onApply: (text: string) => boolean;
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'form'; preview: CopyRegenPreviewResponse }
  | { kind: 'running'; preview: CopyRegenPreviewResponse }
  | { kind: 'result'; preview: CopyRegenPreviewResponse; outcome: CopyRegenOutcome }
  | { kind: 'error'; message: string; imagesBusy?: boolean; preview?: CopyRegenPreviewResponse };

const errorText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/** 이미지 생성 중(409 busy·images)은 오류가 아니라 기다리면 되는 상태라 따로 보여 준다 */
function BlockNotice({ text, imagesBusy }: { text: string; imagesBusy: boolean }) {
  if (imagesBusy) {
    return (
      <p role="status" className="rounded-md border border-[var(--editor-brand)] bg-[var(--brand-primary-tint)] p-2.5 text-[var(--text-primary)] leading-relaxed">
        {text}
      </p>
    );
  }
  return (
    <p role="alert" className="rounded-md border border-[var(--brand-error)] bg-[var(--brand-error-tint)] p-2.5 text-[var(--brand-error-text)]">
      {text}
    </p>
  );
}

export default function CopyRegenerateModal({ jobId, target, onClose, onApply }: CopyRegenerateModalProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [tone, setTone] = useState<CopyRegenTone | null>(null);
  const [note, setNote] = useState('');
  const [picked, setPicked] = useState(0);
  const [applyError, setApplyError] = useState('');
  const aliveRef = useRef(true);
  const inFlightRef = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    aliveRef.current = true;
    copyRegenApi
      .preview(jobId, target.sectionType)
      .then((preview) => aliveRef.current && setPhase({ kind: 'form', preview }))
      .catch((e) => aliveRef.current && setPhase({ kind: 'error', message: errorText(e, '사전 조회 실패') }));
    return () => {
      aliveRef.current = false;
    };
  }, [jobId, target.sectionType]);

  // 누른 버튼이 단계 전환으로 사라지면 포커스가 body로 빠져 Esc가 안 듣고 편집기 단축키(Delete·Ctrl+Z)가 캔버스로 간다 — 창 안으로 되돌린다
  useEffect(() => {
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) panel.focus();
  }, [phase.kind]);

  const start = async (preview: CopyRegenPreviewResponse) => {
    // 처리 중 두 번째 요청은 같은 잡 잠금에 걸려 409가 되고 비용만 든다 — 화면에서 먼저 막는다
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setPhase({ kind: 'running', preview });
    try {
      const res = await copyRegenApi.request(jobId, copyRegenBody(target, { tone, note }));
      if (!aliveRef.current) return;
      setPicked(0);
      setApplyError('');
      setPhase({ kind: 'result', preview, outcome: copyRegenOutcome(res) });
    } catch (e) {
      if (!aliveRef.current) return;
      const block = e instanceof CopyRegenApiError ? copyRegenBlockText({ code: e.code, busyKind: e.busyKind, error: e.message }) : null;
      setPhase({ kind: 'error', message: block?.text ?? errorText(e, '카피 재생성 요청 실패'), imagesBusy: block?.imagesBusy, preview });
    } finally {
      inFlightRef.current = false;
    }
  };

  const apply = (text: string) => {
    if (onApply(text)) onClose();
    else setApplyError('글자 요소를 찾지 못해 넣지 못했습니다(지워졌거나 잠겼습니다).');
  };

  const busy = phase.kind === 'running';
  const close = () => {
    // 처리 중에 닫으면 서버 요청은 끝까지 돌고(비용 발생) 결과만 버린다
    aliveRef.current = false;
    onClose();
  };
  const retryPreview = phase.kind === 'result' || phase.kind === 'error' ? phase.preview : undefined;
  const previewBlock = (phase.kind === 'form' || phase.kind === 'running') && phase.preview.blocked ? copyRegenBlockText(phase.preview.blocked) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={busy ? undefined : close}
      role="dialog"
      aria-modal="true"
      aria-label="AI 카피 다시 쓰기"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="bg-[var(--surface-overlay)] rounded-lg shadow-xl w-[460px] max-h-[80vh] flex flex-col outline-none"
        onClick={(e) => e.stopPropagation()}
        // 편집기 단축키(Delete·Ctrl+Z 등)가 모달 입력 중에 캔버스로 가지 않게 막는다
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape' && !busy) close();
        }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-default)]">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-[var(--editor-brand)]" />
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">AI 카피 다시 쓰기</h2>
          </div>
          <button
            onClick={close}
            aria-label="닫기"
            className="p-1 rounded hover:bg-[var(--hover-overlay)] text-[var(--text-disabled)] hover:text-[var(--text-secondary)] cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 text-xs text-[var(--text-secondary)]">
          <div className="flex flex-col gap-1">
            <span className="font-medium text-[var(--text-primary)]">지금 카피</span>
            <p className="rounded-md border border-[var(--border-default)] bg-[var(--surface-base)] p-2.5 whitespace-pre-line text-[var(--text-primary)] leading-relaxed">
              {target.currentText}
            </p>
            <p className="leading-relaxed">
              이 글자만 다시 씁니다. 원본 카피와 다른 글자는 그대로이고, 금지 표현·길이 검사를 통과한 후보만 보여 줍니다.
              {target.hasRichText && ' 글자 안 부분 색·크기 강조는 빠지고 글자 전체 서식으로 들어갑니다.'}
            </p>
          </div>

          {phase.kind === 'loading' && (
            <p className="flex items-center gap-2 text-[var(--text-disabled)]">
              <Loader2 size={14} className="animate-spin" /> 비용과 실행 가능 여부를 확인하는 중…
            </p>
          )}

          {(phase.kind === 'form' || phase.kind === 'running') && (
            <>
              <fieldset disabled={busy} className="flex flex-col gap-1.5">
                <legend className="mb-1 font-medium text-[var(--text-primary)]">어조(선택)</legend>
                <div className="flex flex-wrap gap-1.5">
                  {[null, ...COPY_REGEN_TONE_ORDER].map((t) => (
                    <button
                      key={t ?? 'auto'}
                      type="button"
                      aria-pressed={tone === t}
                      onClick={() => setTone(t)}
                      className={`px-2 py-1 rounded-md border transition-colors cursor-pointer ${
                        tone === t
                          ? 'border-[var(--editor-brand)] text-[var(--editor-brand)] bg-[var(--brand-primary-tint)]'
                          : 'border-[var(--border-default)] hover:border-[var(--editor-brand)]'
                      }`}
                    >
                      {t ? COPY_REGEN_TONE_LABELS[t] : '상품 전략대로'}
                    </button>
                  ))}
                </div>
                <label className="mt-2 font-medium text-[var(--text-primary)]" htmlFor="copy-regen-note">
                  요청(선택, {COPY_REGEN_NOTE_MAX_CHARS}자까지)
                </label>
                <textarea
                  id="copy-regen-note"
                  value={note}
                  maxLength={COPY_REGEN_NOTE_MAX_CHARS}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  placeholder="예: 더 짧고 단정하게"
                  className="w-full px-2 py-1.5 rounded border border-[var(--border-default)] bg-[var(--surface-base)] text-[var(--text-primary)] resize-none"
                />
                <span className="self-end text-[10px] text-[var(--text-disabled)]">
                  {note.length}/{COPY_REGEN_NOTE_MAX_CHARS}
                </span>
              </fieldset>

              <div className="rounded-md border border-[var(--border-default)] bg-[var(--surface-base)] p-2.5 flex flex-col gap-1">
                <span className="font-medium text-[var(--text-primary)]">예상 비용</span>
                {copyRegenCostLines(phase.preview.estimate).map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </div>

              {previewBlock && (
                <BlockNotice
                  text={previewBlock.imagesBusy ? previewBlock.text : `지금은 실행할 수 없습니다: ${previewBlock.text}`}
                  imagesBusy={previewBlock.imagesBusy}
                />
              )}

              {busy && (
                <p className="flex items-center gap-2 text-[var(--text-primary)]">
                  <Loader2 size={14} className="animate-spin" /> 후보를 만드는 중입니다. 보통 수 초, 길면 1분쯤 걸립니다…
                </p>
              )}
            </>
          )}

          {phase.kind === 'result' && phase.outcome.kind === 'candidates' && (
            <div role="radiogroup" aria-label="후보" className="flex flex-col gap-1.5">
              <span className="font-medium text-[var(--text-primary)]">후보를 하나 고르세요</span>
              {phase.outcome.candidates.map((c, i) => (
                <button
                  key={`${i}-${c}`}
                  type="button"
                  role="radio"
                  aria-checked={picked === i}
                  onClick={() => setPicked(i)}
                  className={`text-left rounded-md border p-2.5 whitespace-pre-line leading-relaxed transition-colors cursor-pointer ${
                    picked === i
                      ? 'border-[var(--editor-brand)] bg-[var(--brand-primary-tint)] text-[var(--text-primary)]'
                      : 'border-[var(--border-default)] hover:border-[var(--editor-brand)] text-[var(--text-primary)]'
                  }`}
                >
                  {c}
                </button>
              ))}
              <span className="text-[10px] text-[var(--text-disabled)]">
                이번 비용 {formatUsd(phase.outcome.costUsd)}
                {phase.outcome.filtered > 0 && ` · 검사에서 걸러진 후보 ${phase.outcome.filtered}개`}
              </span>
              {applyError && (
                <p role="alert" className="rounded-md border border-[var(--brand-error)] bg-[var(--brand-error-tint)] p-2.5 text-[var(--brand-error-text)]">
                  {applyError}
                </p>
              )}
            </div>
          )}

          {phase.kind === 'result' && phase.outcome.kind === 'none' && (
            <div role="alert" className="rounded-md border border-[var(--brand-error)] bg-[var(--brand-error-tint)] p-2.5 text-[var(--brand-error-text)] leading-relaxed flex flex-col gap-1">
              <span>{phase.outcome.message} 지금 카피를 그대로 둡니다.</span>
              {phase.outcome.details.map((d, i) => (
                <span key={`${i}-${d}`}>· {d}</span>
              ))}
              <span className="text-[10px]">이번 비용 {formatUsd(phase.outcome.costUsd)}</span>
            </div>
          )}

          {phase.kind === 'error' && <BlockNotice text={phase.message} imagesBusy={Boolean(phase.imagesBusy)} />}
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-[var(--border-subtle)]">
          <button
            onClick={close}
            className="px-3 py-1.5 rounded text-xs text-[var(--text-secondary)] hover:bg-[var(--hover-overlay)] cursor-pointer"
          >
            {busy ? '창 닫기(결과 버림)' : phase.kind === 'result' || phase.kind === 'error' ? '닫기' : '취소'}
          </button>
          {retryPreview && (
            <button
              onClick={() => setPhase({ kind: 'form', preview: retryPreview })}
              className="px-3 py-1.5 rounded text-xs border border-[var(--border-default)] text-[var(--text-primary)] hover:border-[var(--editor-brand)] cursor-pointer"
            >
              다시 받기
            </button>
          )}
          {phase.kind === 'form' && (
            <button
              onClick={() => void start(phase.preview)}
              disabled={Boolean(phase.preview.blocked)}
              className="px-3 py-1.5 rounded text-xs text-white bg-[var(--editor-brand)] hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              비용 확인하고 후보 받기
            </button>
          )}
          {phase.kind === 'running' && (
            <button disabled className="px-3 py-1.5 rounded text-xs text-white bg-[var(--editor-brand)] opacity-40 cursor-not-allowed">
              받는 중…
            </button>
          )}
          {phase.kind === 'result' && phase.outcome.kind === 'candidates' && (
            <button
              onClick={() => phase.outcome.kind === 'candidates' && apply(phase.outcome.candidates[picked])}
              className="px-3 py-1.5 rounded text-xs text-white bg-[var(--editor-brand)] hover:opacity-90 cursor-pointer"
            >
              이 후보로 바꾸기
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
