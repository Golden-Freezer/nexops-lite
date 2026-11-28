'use client';

// editor/regen/RegenerateModal.tsx — 컷 하나 AI 재생성(묶음 5 ③, NEXFIT RegenerateModal 이식·축소).
// 확인 전에 사전 조회(쓰기 없음)로 비용과 막힌 사유를 보여 준다. 프롬프트는 바꾸지 못한다 — 스타일 6종과 짧은 요청 문구만
// 서버가 '규칙을 넘지 못하는 조정'으로 붙인다(옵션 사진 가드·글자 금지 규칙은 서버 태스크 프롬프트에 그대로 있다). 모델은 잡 모델.
// 진행: runner 'web'은 run 반복 호출, 'local'(코덱스)은 로컬 실행기 처리 대기. 새 이미지는 정체성 확인을 통과한 때만 바뀐다.
// 지금 이미지가 없으면(imageSrc 없음) 사진 없는 섹션에 새 컷을 만드는 창이다(사후 재생성 W5b) — 같은 비용 안내·흐름, 문구만 다르다.
// P1-4: 지금 컷을 바꿀 때는 '유지할 것'과 '지금 컷을 바탕으로 고치기'(기본 켬)를 받고, 바뀐 컷은 '직전 컷으로 되돌리기'(생성 없음)를 보인다.

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { ImagePlus, Loader2, Sparkles, X } from 'lucide-react';
import type { RegenPreviewResponse, RegenStyle } from '@/lib/registration/pdp-image-regen';
import type { PdpJobRow } from '@/lib/registration/pdp-state';
import { regenApi } from '@/lib/registration/editor/services/regenApi';
import { driveRegen, type DriveOutcome } from '@/lib/registration/editor/utils/regenDriver';
import { REGEN_NOTE_LIMIT, REGEN_STYLE_LABELS, REGEN_STYLE_ORDER, regenCostLines } from '@/lib/registration/editor/utils/regenTarget';

interface RegenerateModalProps {
  jobId: string;
  section: string;
  /** 지금 이미지 — 없으면 새 컷 만들기 */
  imageSrc?: string;
  onClose: () => void;
  /** 진행 중 받은 잡(그 섹션 기록 포함) — 호출부가 결과를 캔버스에 반영한다 */
  onJob: (job: PdpJobRow) => void;
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'form'; preview: RegenPreviewResponse }
  | { kind: 'running'; preview: RegenPreviewResponse }
  | { kind: 'result'; outcome: DriveOutcome }
  | { kind: 'reverting' }
  | { kind: 'reverted' }
  | { kind: 'error'; message: string };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export default function RegenerateModal({ jobId, section, imageSrc, onClose, onJob }: RegenerateModalProps) {
  const { getToken } = useAuth();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const adding = !imageSrc;
  const title = adding ? 'AI 새 사진 만들기' : 'AI 이미지 재생성';
  const [style, setStyle] = useState<RegenStyle | null>(null);
  const [note, setNote] = useState('');
  const [keep, setKeep] = useState('');
  const [useCurrent, setUseCurrent] = useState(true);
  const aliveRef = useRef(true);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    aliveRef.current = true;
    regenApi
      .preview(jobId, section)
      .then((preview) => aliveRef.current && setPhase({ kind: 'form', preview }))
      .catch((e) => aliveRef.current && setPhase({ kind: 'error', message: e instanceof Error ? e.message : '사전 조회 실패' }));
    return () => {
      aliveRef.current = false;
    };
  }, [jobId, section]);

  // 누른 버튼이 단계 전환으로 사라지면 포커스가 body로 빠져 Esc가 안 듣고 편집기 단축키(Delete·Ctrl+Z)가 캔버스로 간다 — 창 안으로 되돌린다
  // (카피 다시 쓰기 창 #206과 같은 처리)
  useEffect(() => {
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) panel.focus();
  }, [phase.kind]);

  const start = async (preview: RegenPreviewResponse) => {
    setPhase({ kind: 'running', preview });
    try {
      const res = await regenApi.request(jobId, {
        section,
        ...(style ? { style } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(!adding && keep.trim() ? { keep: keep.trim() } : {}),
        ...(!adding && useCurrent ? { useCurrent: true } : {}),
      });
      onJob(res.job);
      const requestedAt = res.job.section_images.find((e) => e.section === section)?.editorRegen?.requestedAt ?? '';
      const outcome = await driveRegen(jobId, section, requestedAt, res.runner, {
        api: regenApi,
        sleep,
        alive: () => aliveRef.current,
        onJob,
        // 탭이 뒤에 있던 사이 낡은 토큰으로 run이 401이면 새로 받아 다시 보낸다(R12a — 진행 화면과 같은 규칙)
        refreshToken: () => getToken({ skipCache: true }),
      });
      if (aliveRef.current) setPhase({ kind: 'result', outcome });
    } catch (e) {
      if (!aliveRef.current) return;
      setPhase({ kind: 'error', message: e instanceof Error ? e.message : '재생성 요청 실패' });
    }
  };

  // 직전 컷으로 되돌리기 — url·장식을 바뀌기 전 것과 맞바꾼다(생성·비용 없음). 받은 잡으로 호출부가 캔버스 src를 바꾼다
  const revert = async () => {
    setPhase({ kind: 'reverting' });
    try {
      const res = await regenApi.revert(jobId, section);
      onJob(res.job);
      if (aliveRef.current) setPhase({ kind: 'reverted' });
    } catch (e) {
      if (aliveRef.current) setPhase({ kind: 'error', message: e instanceof Error ? e.message : '되돌리기 실패' });
    }
  };
  const canRevert =
    !adding &&
    ((phase.kind === 'form' && phase.preview.revertible === true) || (phase.kind === 'result' && phase.outcome.state === 'done'));

  const busy = phase.kind === 'running' || phase.kind === 'reverting';
  const close = () => {
    // 진행 중에 닫아도 서버 대기는 남는다(다시 열면 결과를 이어서 반영) — 여기서는 화면 쪽 호출만 멈춘다
    aliveRef.current = false;
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={busy ? undefined : close}
      role="dialog"
      aria-modal="true"
      aria-label={title}
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
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h2>
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
          <div className="flex gap-3 items-start">
            {imageSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageSrc} alt="지금 이미지" className="w-20 h-20 rounded object-cover border border-[var(--border-default)] shrink-0" />
            ) : (
              <span className="w-20 h-20 rounded border border-dashed border-[var(--border-default)] shrink-0 flex items-center justify-center text-[var(--text-disabled)]">
                <ImagePlus size={20} />
              </span>
            )}
            <p className="leading-relaxed">
              {adding
                ? '이 섹션에 쓸 사진을 같은 상품으로 새로 만듭니다. 원천 사진·옵션 사진 규칙과 대표 사진 스타일을 따르고, 정체성 확인(같은 상품·결함)을 통과한 때만 섹션 끝에 넣습니다. 장면은 상품 정보로 만든 이 섹션의 기본 지시를 따르며, 편집기에서 이 섹션에 쓴 문구는 들어가지 않습니다 — 원하는 장면은 아래 요청에 적어 주세요.'
                : '이 컷을 같은 상품으로 다시 만듭니다. 원천 사진·옵션 사진 규칙은 그대로이고, 새 이미지가 정체성 확인(같은 상품·결함)을 통과한 때만 바뀝니다.'}
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
                <legend className="mb-1 font-medium text-[var(--text-primary)]">스타일(선택)</legend>
                <div className="flex flex-wrap gap-1.5">
                  {[null, ...REGEN_STYLE_ORDER].map((s) => (
                    <button
                      key={s ?? 'none'}
                      type="button"
                      aria-pressed={style === s}
                      onClick={() => setStyle(s)}
                      className={`px-2 py-1 rounded-md border transition-colors cursor-pointer ${
                        style === s
                          ? 'border-[var(--editor-brand)] text-[var(--editor-brand)] bg-[var(--brand-primary-tint)]'
                          : 'border-[var(--border-default)] hover:border-[var(--editor-brand)]'
                      }`}
                    >
                      {s ? REGEN_STYLE_LABELS[s] : '그대로'}
                    </button>
                  ))}
                </div>
                <label className="mt-2 font-medium text-[var(--text-primary)]" htmlFor="regen-note">
                  요청(선택, {REGEN_NOTE_LIMIT}자까지)
                </label>
                <textarea
                  id="regen-note"
                  value={note}
                  maxLength={REGEN_NOTE_LIMIT}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  placeholder="예: 배경을 조금 더 밝게"
                  className="w-full px-2 py-1.5 rounded border border-[var(--border-default)] bg-[var(--surface-base)] text-[var(--text-primary)] resize-none"
                />
                <span className="self-end text-[10px] text-[var(--text-disabled)]">
                  {note.length}/{REGEN_NOTE_LIMIT}
                </span>
                {!adding && (
                  <>
                    <label className="font-medium text-[var(--text-primary)]" htmlFor="regen-keep">
                      유지할 것(선택, {REGEN_NOTE_LIMIT}자까지)
                    </label>
                    <textarea
                      id="regen-keep"
                      value={keep}
                      maxLength={REGEN_NOTE_LIMIT}
                      onChange={(e) => setKeep(e.target.value)}
                      rows={2}
                      placeholder="예: 제품 각도와 오른쪽 소품은 그대로"
                      className="w-full px-2 py-1.5 rounded border border-[var(--border-default)] bg-[var(--surface-base)] text-[var(--text-primary)] resize-none"
                    />
                    <label className="mt-1 flex items-center gap-1.5 text-[var(--text-primary)]">
                      <input type="checkbox" checked={useCurrent} onChange={(e) => setUseCurrent(e.target.checked)} />
                      지금 컷을 바탕으로 고치기
                      <span className="text-[var(--text-disabled)]">(끄면 처음부터 새로 만듭니다)</span>
                    </label>
                  </>
                )}
              </fieldset>

              <div className="rounded-md border border-[var(--border-default)] bg-[var(--surface-base)] p-2.5 flex flex-col gap-1">
                <span className="font-medium text-[var(--text-primary)]">예상 비용</span>
                {regenCostLines(phase.preview.estimate).map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </div>

              {phase.preview.blocked && (
                <p role="alert" className="rounded-md border border-[var(--brand-error)] bg-[var(--brand-error-tint)] p-2.5 text-[var(--brand-error-text)]">
                  지금은 실행할 수 없습니다: {phase.preview.blocked.error}
                </p>
              )}

              {busy && (
                <p className="flex items-center gap-2 text-[var(--text-primary)]">
                  <Loader2 size={14} className="animate-spin" />
                  {phase.preview.runner === 'local' ? '로컬 실행기가 만드는 중입니다(코덱스)…' : '만드는 중입니다. 정체성 확인까지 1~2분 걸릴 수 있습니다…'}
                </p>
              )}
            </>
          )}

          {phase.kind === 'result' && <ResultView outcome={phase.outcome} adding={adding} />}

          {phase.kind === 'reverting' && (
            <p className="flex items-center gap-2 text-[var(--text-primary)]">
              <Loader2 size={14} className="animate-spin" /> 직전 컷으로 되돌리는 중…
            </p>
          )}
          {phase.kind === 'reverted' && (
            <p className="rounded-md border border-[var(--border-default)] bg-[var(--surface-base)] p-2.5 text-[var(--text-primary)] leading-relaxed">
              직전 컷으로 되돌렸습니다(같은 컷이 든 자리 모두). 비용은 들지 않았고, 이 창을 다시 열어 되돌리면 방금 컷으로 돌아갑니다.
            </p>
          )}

          {phase.kind === 'error' && (
            <p role="alert" className="rounded-md border border-[var(--brand-error)] bg-[var(--brand-error-tint)] p-2.5 text-[var(--brand-error-text)]">
              {phase.message}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-[var(--border-subtle)]">
          <button
            onClick={close}
            className="px-3 py-1.5 rounded text-xs text-[var(--text-secondary)] hover:bg-[var(--hover-overlay)] cursor-pointer"
          >
            {phase.kind === 'result' || phase.kind === 'error' || phase.kind === 'reverted'
              ? '닫기'
              : busy
                ? '창 닫기(서버에서 계속)'
                : '취소'}
          </button>
          {canRevert && (
            <button
              onClick={() => void revert()}
              className="px-3 py-1.5 rounded text-xs border border-[var(--border-default)] text-[var(--text-primary)] hover:bg-[var(--hover-overlay)] cursor-pointer"
            >
              직전 컷으로 되돌리기
            </button>
          )}
          {phase.kind === 'form' && (
            <button
              onClick={() => void start(phase.preview)}
              disabled={Boolean(phase.preview.blocked)}
              className="px-3 py-1.5 rounded text-xs text-white bg-[var(--editor-brand)] hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              {phase.preview.estimate.billed ? `비용 확인하고 ${adding ? '만들기' : '재생성'}` : adding ? '만들기' : '재생성'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ResultView({ outcome, adding }: { outcome: DriveOutcome; adding: boolean }) {
  if (outcome.state === 'done') {
    return (
      <p className="rounded-md border border-[var(--border-default)] bg-[var(--surface-base)] p-2.5 text-[var(--text-primary)] leading-relaxed">
        {adding
          ? '새 사진을 이 섹션 끝에 넣었습니다. 위치·크기는 바로 고칠 수 있고 Ctrl+Z로 되돌릴 수 있습니다. 상세 이미지를 이미 구웠다면 다시 구워 주세요.'
          : '새 이미지로 바꿨습니다(같은 컷이 든 자리 모두). Ctrl+Z로 되돌릴 수 있습니다. 상세 이미지를 이미 구웠다면 다시 구워 주세요.'}
      </p>
    );
  }
  if (outcome.state === 'rejected' || outcome.state === 'failed') {
    const rejected = outcome.state === 'rejected';
    const head = adding
      ? rejected
        ? '새 사진이 정체성 확인을 통과하지 못해 넣지 않았습니다.'
        : '새 사진을 만들지 못했습니다.'
      : rejected
        ? '새 이미지가 정체성 확인을 통과하지 못해 이전 이미지를 그대로 둡니다.'
        : '이미지를 만들지 못해 이전 이미지를 그대로 둡니다.';
    return (
      <p role="alert" className="rounded-md border border-[var(--brand-error)] bg-[var(--brand-error-tint)] p-2.5 text-[var(--brand-error-text)] leading-relaxed">
        {head} {outcome.message}
      </p>
    );
  }
  if (outcome.state === 'waiting') return <p className="leading-relaxed">{outcome.reason}</p>;
  return null;
}
