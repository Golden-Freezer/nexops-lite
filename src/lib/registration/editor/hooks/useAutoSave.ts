'use client';

import { useEffect, useRef } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useEditorStore } from '@/lib/registration/editor/stores/editorStore';
import { useCanvasStore } from '@/lib/registration/editor/stores/canvasStore';
import { saveEditorData } from '@/lib/registration/editor/services/editorApi';
import { toast } from '@/components/features/registration/editor/ui/Toast';
import type { CanvasSection } from '@/lib/registration/editor/types/canvas';
import { BASELINE_ASSIGNMENT_KEY, serializeBaseline } from '@/lib/registration/editor/utils/editorBaseline';

const DEBOUNCE_MS = 3000;
const RETRY_MS = 10_000;
const SAVED_LABEL_TTL = 2000;
const MAX_RETRIES = 3;
const MAX_BASELINE_SERIALIZED_LENGTH = 2_000_000;

let hasWarnedOversizedBaseline = false;

/**
 * 에디터 자동 저장 훅
 *
 * - isDirty 변경 감지 → 3초 디바운스 후 저장
 * - saveRequested 감지 → 즉시 저장 (Ctrl+S, 수동 저장 버튼)
 * - 저장 실패 시 10초 후 자동 재시도
 * - 컴포넌트 언마운트 시 미저장 데이터 즉시 저장 시도
 */
export function useAutoSave(pdpId: string) {
  const { getToken } = useAuth();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedLabelRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSavingRef = useRef(false);
  // L18: in-flight 저장 중 들어온 저장 요청(언마운트 최종 저장 포함)을 유실하지 않도록
  // 플래그로 큐잉해 두었다가 현재 저장 완료 직후 1회 재실행한다.
  const pendingSaveRef = useRef(false);
  const retryCountRef = useRef(0);
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  // pdpId를 ref에 캡처 (subscribe 콜백 내에서 최신 값 참조)
  const pdpIdRef = useRef(pdpId);
  pdpIdRef.current = pdpId;

  useEffect(() => {
    const doSave = async () => {
      if (isSavingRef.current) {
        // L18: 진행 중 저장과 경합 — 완료 후 재실행하도록 큐잉 (silent drop 방지)
        pendingSaveRef.current = true;
        return;
      }

      // 드래그/리사이즈 제스처 중에는 store 좌표가 실시간 갱신되므로
      // 중간 좌표가 저장되지 않도록 종료까지 대기 후 재시도 (Ctrl+S 포함)
      const canvasState = useCanvasStore.getState();
      if (canvasState.isDragging || canvasState.isResizing) {
        setTimeout(doSave, 300);
        return;
      }

      isSavingRef.current = true;

      if (retryRef.current) {
        clearTimeout(retryRef.current);
        retryRef.current = null;
      }

      // 저장 직전: 신규 변환 세션 섹션만 reflow로 정합화 후 정산(플래그 해제).
      // 정산된 섹션은 "화면에 보이는 그대로"가 저장되고, 재로드 마운트에서
      // 실측/자동 reflow가 배치를 재구성하지 않는다 (WYSIWYG 저장 불변식)
      {
        const st = useEditorStore.getState();
        st.document?.sections.forEach((s: CanvasSection) => {
          if (s.needsInitialReflow) st.reflowSection(s.id);
        });
        st.settleInitialReflow();
      }

      const { document: doc, setSaveStatus, markSaved } = useEditorStore.getState();
      if (!doc) { isSavingRef.current = false; return; }

      // 빈 문서 저장 방어 — 빈 sections_data가 저장되면 다음 로드에서
      // 파이프라인 원본 재변환으로 사용자 편집이 통째로 소실된다
      if (!doc.sections.length) {
        console.warn('[useAutoSave] 빈 문서 저장 차단 — 섹션이 0개입니다');
        // 무음 스킵이면 사용자는 저장된 줄 알고 이탈한다(verifier 적발) — 명시적으로 알린다.
        toast.error('빈 문서는 저장되지 않습니다 — 섹션을 최소 1개 남겨주세요.');
        setSaveStatus('idle');
        isSavingRef.current = false;
        return;
      }

      setSaveStatus('saving');

      const layout_assignments: Record<string, string> = {};
      doc.sections.forEach((s: CanvasSection) => {
        layout_assignments[s.id] = s.layoutId;
      });
      if (doc.initialBaseline) {
        const serializedBaseline = serializeBaseline(doc.initialBaseline);
        if (serializedBaseline.length <= MAX_BASELINE_SERIALIZED_LENGTH) {
          layout_assignments[BASELINE_ASSIGNMENT_KEY] = serializedBaseline;
        } else if (!hasWarnedOversizedBaseline) {
          console.warn('[useAutoSave] 초기 baseline 캐리 생략 — 직렬화 길이가 2,000,000자를 초과했습니다');
          hasWarnedOversizedBaseline = true;
        }
      }

      try {
        const token = (await getTokenRef.current()) ?? '';
        await saveEditorData(pdpIdRef.current, token, {
          sections_data: doc.sections as unknown[],
          layout_assignments,
        });

        retryCountRef.current = 0;
        markSaved(); // isDirty = false, saveStatus = 'saved'

        // 2초 후 저장됨 표시 제거
        if (savedLabelRef.current) clearTimeout(savedLabelRef.current);
        savedLabelRef.current = setTimeout(() => {
          const s = useEditorStore.getState();
          if (s.saveStatus === 'saved' && !s.isDirty) {
            s.setSaveStatus('idle');
          }
        }, SAVED_LABEL_TTL);
      } catch {
        useEditorStore.getState().setSaveStatus('error');
        retryCountRef.current += 1;
        if (retryCountRef.current <= MAX_RETRIES) {
          const delay = RETRY_MS * Math.pow(2, retryCountRef.current - 1);
          retryRef.current = setTimeout(doSave, delay);
        } else {
          console.warn('[useAutoSave] 최대 재시도 횟수 초과 — 수동 저장 필요');
          toast.error('자동 저장에 계속 실패하고 있습니다. Ctrl+S 또는 상단 저장 버튼으로 다시 시도해 주세요.');
        }
      } finally {
        isSavingRef.current = false;
        // L18: 저장 중 큐잉된 요청이 있으면 아직 dirty한 경우에 한해 1회 재실행
        if (pendingSaveRef.current) {
          pendingSaveRef.current = false;
          if (useEditorStore.getState().isDirty) {
            void doSave();
          }
        }
      }
    };

    const unsub = useEditorStore.subscribe((state, prevState) => {
      // 즉시 저장 요청 (Ctrl+S / 수동 버튼)
      if (state.saveRequested && !prevState.saveRequested) {
        useEditorStore.getState().clearSaveRequest();
        if (debounceRef.current) clearTimeout(debounceRef.current);
        doSave();
        return;
      }

      // 문서 변경 감지 → 3초 디바운스 (발화 시점에 여전히 dirty일 때만 저장 —
      // 저장 직전 reflow 정합화가 유발하는 document 참조 변경으로 인한 중복 저장 방지)
      if (state.isDirty && state.document !== prevState.document) {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          if (useEditorStore.getState().isDirty) doSave();
        }, DEBOUNCE_MS);
      }
    });

    return () => {
      unsub();
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (retryRef.current) clearTimeout(retryRef.current);
      if (savedLabelRef.current) clearTimeout(savedLabelRef.current);

      // 언마운트 시 미저장 데이터 즉시 저장 시도 (fire-and-forget)
      if (useEditorStore.getState().isDirty) {
        doSave();
      }
    };
    // pdpId 변경 시 subscribe 재설정
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdpId]);
}
