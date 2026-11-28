'use client';

import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { useEditorStore, selectSelectedElementIds, selectZoom, selectStyleRemeasure } from '@/lib/registration/editor/stores/editorStore';
import { useCanvasStore } from '@/lib/registration/editor/stores/canvasStore';
import { useAuth } from '@/lib/auth/clerk-shim';
import { uploadImageViaSignedUrl } from '@/lib/registration/editor/services/editorApi';
import type { CanvasElement } from '@/lib/registration/editor/types/canvas';
import { sanitizeRichText, richTextToPlainText, normalizeRichText } from '@/lib/registration/editor/utils/textSanitizer';
import { useFontEpoch } from '@/lib/registration/editor/hooks/useFontEpoch';
import ImageActionToolbar from './ImageActionToolbar';
import ImageCropOverlay from './ImageCropOverlay';
import { selectCropTarget } from '@/lib/registration/editor/stores/editorStore';
import { Z_INDEX, MULTILINE_HEADING_LINE_HEIGHT, BALANCED_HEADING_MIN_FONT } from '@/lib/registration/editor/constants/designTokens';
import { estimateWrappedLines } from '@/lib/registration/editor/utils/sectionConverter/helpers';
import { useMotionPreviewSrc } from './MotionPreview';

interface CanvasElementProps {
  element: CanvasElement;
  sectionId: string;
  sectionType: string;
  onContextMenu?: (e: React.MouseEvent, elementId: string, sectionId: string) => void;
}

export default function CanvasElementComponent({ element, sectionId, onContextMenu }: CanvasElementProps) {
  const selectedElementIds = useEditorStore(selectSelectedElementIds);
  const selectElement      = useEditorStore((s) => s.selectElement);
  const selectSection      = useEditorStore((s) => s.selectSection);
  const toggleElementSelection = useEditorStore((s) => s.toggleElementSelection);
  const updateElement      = useEditorStore((s) => s.updateElement);
  const setMeasuredHeight  = useEditorStore((s) => s.setMeasuredHeight);
  const pdpId              = useEditorStore((s) => s.document?.pdpId ?? '');

  const cropTarget   = useEditorStore(selectCropTarget);
  const setCropTarget = useEditorStore((s) => s.setCropTarget);
  const zoom         = useEditorStore(selectZoom);
  const startDrag  = useCanvasStore((s) => s.startDrag);
  const isDragging = useCanvasStore((s) => s.isDragging);
  const isResizingThis = useCanvasStore((s) =>
    s.isResizing && s.resizeState.resizeElementId === element.id
  );
  const commitHistory = useCanvasStore((s) => s.commitHistory);
  const { getToken } = useAuth();

  const [imgError, setImgError] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  // 미리보기 세 곳에서 켠 움직이는 칸만 WebP — 본 캔버스(굽기 원본)는 공급자가 없어 늘 null(결정 카드 c30). 못 받으면 포스터로
  const motionPreviewSrc = useMotionPreviewSrc(element.id);
  const [motionPreviewFailed, setMotionPreviewFailed] = useState(false);
  const motionSrc = motionPreviewSrc && !motionPreviewFailed ? motionPreviewSrc : null;
  const onPhotoError = () => (motionSrc ? setMotionPreviewFailed(true) : setImgError(true));

  // 호버 딜레이 타이머
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 텍스트 편집용 ref
  const textDivRef = useRef<HTMLDivElement>(null);
  // 편집 취소 시 복원할 원본 내용
  const originalContentRef = useRef<string>('');

  const isSelected = selectedElementIds.includes(element.id);
  const { transform } = element;

  // 비편집 상태일 때 DOM 텍스트 내용을 textProps와 동기화
  useEffect(() => {
    const div = textDivRef.current;
    if (!div || isEditing) return;
    const richContent = element.textProps?.richContent;
    if (richContent) {
      if (div.innerHTML !== richContent) {
        div.innerHTML = richContent;
      }
    } else {
      const content = element.textProps?.content ?? '';
      if (div.innerText !== content) {
        div.innerText = content;
      }
    }
  }, [element.textProps?.content, element.textProps?.richContent, isEditing]);

  // ── V4.5: 텍스트 자동 높이 측정 ──────────────────────────────────────────────
  const isAutoHeight = element.type === 'text' && element.autoHeight !== false;
  // 웹폰트 스왑 후 재측정 안전망 — 폴백 폰트 기준 측정이 굳는 것을 방지
  const fontEpoch = useFontEpoch();

  useLayoutEffect(() => {
    if (!isAutoHeight) return;
    // 신규 변환 세션(needsInitialReflow)에서만 마운트 실측을 상태에 기록한다.
    // 저장본/프리셋 기하는 사용자가 승인한 진실 — 실측 불일치를 상태에 올리면
    // 이후 어떤 reflow 경로든 배치를 재구성해 버린다 (재접속 배치 붕괴의 원인).
    // 편집 커밋(exitEditMode)은 자체적으로 실측을 동기화하므로 영향 없음.
    const sec = useEditorStore.getState().document?.sections.find((s) => s.id === sectionId);
    if (!sec?.needsInitialReflow) return;
    // 폰트 로딩 진행 중에는 측정을 보류 — 폴백 폰트 오측정이 reflow에 유입되면
    // 임계선 비대칭 때문에 비가역 표류가 된다. 로드 완료 시 fontEpoch가 재측정을 트리거.
    if (typeof document !== 'undefined' && document.fonts?.status === 'loading') return;
    const div = textDivRef.current;
    if (!div) return;
    const measured = div.scrollHeight;
    if (measured > 0 && Math.abs(measured - (element.measuredHeight ?? 0)) > 2) {
      setMeasuredHeight(sectionId, element.id, measured);
    }
  }, [isAutoHeight, fontEpoch, element.textProps?.content, element.textProps?.richContent,
      element.textProps?.fontSize, element.textProps?.lineHeight, element.transform.width,
      element.id, element.measuredHeight, sectionId, setMeasuredHeight]);

  // ── V4.5: measuredHeight 변경 시 섹션 리플로우 트리거 ──────────────────────────
  // needsInitialReflow(신규 변환 세션)일 때만 자동 발동 — 저장본/프리셋 기하는
  // 사용자가 승인한 진실이므로 마운트 실측이 배치를 재구성하면 안 된다.
  // (편집 커밋·카드 파라미터 변경은 각자 reflowSection을 명시 호출한다)
  useEffect(() => {
    if (!isAutoHeight || !element.measuredHeight) return;
    const sec = useEditorStore.getState().document?.sections.find((s) => s.id === sectionId);
    if (!sec?.needsInitialReflow) return;
    useEditorStore.getState().reflowSection(sectionId);
  }, [isAutoHeight, element.measuredHeight, sectionId]);

  // ── P1-1: 툴바 스타일 변경(기하 영향 키) 후 1회 재측정 ──────────────────────
  // 마운트 실측(needsInitialReflow 한정)과 달리, 사용자가 명시적으로 스타일을
  // 바꾼 요소에만 요청 기반으로 작동한다 — 저장본 기하를 임의로 재구성하지 않는다.
  const styleRemeasure = useEditorStore(selectStyleRemeasure);
  useEffect(() => {
    if (!styleRemeasure || styleRemeasure.elementId !== element.id) return;
    const finish = () => useEditorStore.getState().clearStyleRemeasure();
    // 수동 높이 요소(autoHeight=false)는 사용자가 잡은 박스를 유지한다 (기존 계약)
    if (!isAutoHeight) { finish(); return; }
    const div = textDivRef.current;
    if (!div) { finish(); return; }
    let cancelled = false;
    const measure = () => {
      if (cancelled) return;
      div.style.overflow = 'visible';
      div.style.height = 'auto';
      const naturalH = div.scrollHeight;
      div.style.overflow = '';
      div.style.height = '';
      if (naturalH > 0) {
        const el = useEditorStore.getState().document?.sections
          .find((s) => s.id === sectionId)?.elements.find((e) => e.id === element.id);
        if (el) {
          const minH = Math.max(20, el.textProps?.fontSize ?? 16);
          const newHeight = Math.max(naturalH, minH);
          updateElement(sectionId, element.id, {
            measuredHeight: newHeight,
            ...(newHeight !== el.transform.height
              ? { transform: { ...el.transform, height: newHeight } }
              : {}),
          });
          useEditorStore.getState().reflowSection(sectionId);
        }
      }
      finish();
    };
    // 폰트 교체 직후 로딩 중이면 폴백 폰트 오측정을 피하기 위해 로드 완료 후 측정
    if (typeof document !== 'undefined' && document.fonts?.status === 'loading') {
      document.fonts.ready.then(measure);
    } else {
      measure();
    }
    return () => { cancelled = true; };
  }, [styleRemeasure, isAutoHeight, element.id, sectionId, updateElement]);

  // ── 텍스트 편집 모드 진입 ───────────────────────────────────────────────────
  const enterEditMode = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (element.isLocked || element.type !== 'text' || !element.textProps) return;

    const tp = element.textProps;
    // richContent가 있으면 그걸 저장, 없으면 plain text
    originalContentRef.current = tp.richContent || tp.content;
    setIsEditing(true);

    const div = textDivRef.current;
    if (!div) return;

    div.contentEditable = 'true';

    // richContent가 없는 레거시 요소 → plain text를 HTML로 변환
    if (!tp.richContent) {
      const escaped = tp.content
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');
      div.innerHTML = escaped;
    } else {
      div.innerHTML = tp.richContent;
    }

    div.focus();

    // 전체 텍스트 선택
    setTimeout(() => {
      const range = document.createRange();
      range.selectNodeContents(div);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }, 0);
  }, [element.isLocked, element.type, element.textProps]);

  // ── 텍스트 편집 모드 종료 ───────────────────────────────────────────────────
  const exitEditMode = useCallback((cancel = false) => {
    const div = textDivRef.current;
    if (!div) return;

    div.contentEditable = 'false';
    setIsEditing(false);

    if (cancel) {
      // 원본 복원: richContent였으면 HTML, 아니면 plain text
      if (element.textProps?.richContent || originalContentRef.current.includes('<')) {
        div.innerHTML = originalContentRef.current;
      } else {
        div.innerText = originalContentRef.current;
      }
      return;
    }

    const rawHtml = div.innerHTML;
    const sanitized = normalizeRichText(sanitizeRichText(rawHtml));
    const plainText = richTextToPlainText(sanitized);

    // 변경 감지: richContent 또는 plain text 비교
    const prevContent = element.textProps?.richContent || element.textProps?.content || '';
    // 줄바꿈 없는 공백(U+00A0 — 변환기가 수량+단위를 붙인다)은 편집 영역에서 &nbsp;로 나와 보통 공백으로 돌아온다 —
    // 손대지 않은 편집을 변경으로 보지 않게 같은 꼴로 견준다
    const prevPlain = prevContent.replace(/\u00A0/g, ' ');
    const changed = sanitized !== prevContent && plainText !== prevContent && plainText !== prevPlain;

    if (changed) {
      // P1-4: 멀티라인 헤딩 자동 행간 — 측정 '전에' DOM에 반영해 measuredHeight가
      // 최종 행간 기준이 되게 한다. 사용자가 행간을 직접 편집한 요소는 제외.
      const tp0 = element.textProps!;
      let autoLineHeight: number | null = null;
      const level = tp0.typoLevel;
      if (
        (level === 'display' || level === 'h1' || level === 'h2') &&
        !(tp0.userStyledKeys ?? []).includes('lineHeight') &&
        tp0.lineHeight < MULTILINE_HEADING_LINE_HEIGHT
      ) {
        const lines = estimateWrappedLines(
          plainText, tp0.fontSize, element.transform.width, tp0.letterSpacing ?? 0,
        );
        if (lines >= 2) {
          autoLineHeight = MULTILINE_HEADING_LINE_HEIGHT;
          div.style.lineHeight = String(autoLineHeight);
        }
      }

      // 줄바꿈 후 실제 렌더 높이로 height 자동 보정
      div.style.overflow = 'visible';
      div.style.height = 'auto';
      const naturalH = div.scrollHeight;
      div.style.overflow = '';
      div.style.height = '';
      const minH = Math.max(20, element.textProps?.fontSize ?? 16);
      const newHeight = naturalH > 0 ? Math.max(naturalH, minH) : element.transform.height;

      // span이 없으면 richContent 불필요 (plain text만으로 충분)
      const hasSpans = /<span\s/.test(sanitized);

      updateElement(sectionId, element.id, {
        textProps: {
          ...element.textProps!,
          content: plainText,
          richContent: hasSpans ? sanitized : undefined,
        },
        // 실측 높이를 즉시 동기화 — 미동기 시 reflowSection이 편집 전
        // measuredHeight(stale)로 아래 요소를 잘못 밀었다가 재실측 후
        // 되돌리는 깜빡임 + 그 사이 상태가 히스토리에 박제되는 문제
        measuredHeight: naturalH > 0 ? Math.max(naturalH, minH) : element.measuredHeight,
        ...(newHeight !== element.transform.height ? { transform: { ...element.transform, height: newHeight } } : {}),
      });
      if (autoLineHeight !== null) {
        // updateElement가 아닌 전용 액션 — userStyledKeys에 lineHeight를 남기지 않는다
        useEditorStore.getState().applyAutoTextProps(sectionId, element.id, { lineHeight: autoLineHeight });
      }
      useEditorStore.getState().reflowSection(sectionId);

      const sections = useEditorStore.getState().document?.sections;
      if (sections) {
        commitHistory('텍스트 수정', sections);
      }
    }
  }, [element.id, element.textProps, element.transform, element.measuredHeight, sectionId, updateElement, commitHistory]);

  // ── 우클릭 컨텍스트 메뉴 ─────────────────────────────────────────────────────
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isSelected) {
      selectElement(element.id);
      // 그룹 자동 선택 확장
      if (element.groupId) {
        const doc = useEditorStore.getState().document;
        if (doc) {
          const ids: string[] = [];
          for (const sec of doc.sections) {
            for (const el of sec.elements) {
              if (el.groupId === element.groupId) ids.push(el.id);
            }
          }
          if (ids.length > 1) {
            useEditorStore.setState({ selectedElementIds: ids, selectedElementId: element.id });
          }
        }
      }
    }
    onContextMenu?.(e, element.id, sectionId);
  };

  // ── 포인터 다운 (드래그 / 선택) ─────────────────────────────────────────────
  const handlePointerDown = (e: React.PointerEvent) => {
    // 편집 중에는 드래그 비활성화
    if (isEditing) return;
    if (e.button !== 0) return;  // 좌클릭만 처리 — 우클릭은 handleContextMenu에서 관리
    // 크롭 중인 요소에서는 드래그 시작 차단 — 크롭 핸들/버튼 이벤트 보호
    if (cropTarget?.elementId === element.id) return;

    e.stopPropagation();

    // 섹션을 먼저 선택 (다른 섹션이면 요소 해제됨)
    selectSection(sectionId);
    // 그 뒤 요소 선택 (같은 섹션이면 기존 요소 유지 후 덮어쓰기)
    if (e.shiftKey) {
      toggleElementSelection(element.id);
    } else {
      const currentIds = useEditorStore.getState().selectedElementIds;
      if (!currentIds.includes(element.id)) {
        // 미선택 요소 클릭 → 단일 선택
        selectElement(element.id);
        // 그룹 자동 선택 확장
        if (element.groupId) {
          const doc = useEditorStore.getState().document;
          if (doc) {
            const ids: string[] = [];
            for (const sec of doc.sections) {
              for (const el of sec.elements) {
                if (el.groupId === element.groupId) ids.push(el.id);
              }
            }
            if (ids.length > 1) {
              useEditorStore.setState({ selectedElementIds: ids, selectedElementId: element.id });
            }
          }
        }
      }
      // 이미 선택된 요소 클릭 → 기존 다중선택 유지
    }

    if (element.isLocked) return;

    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    startDrag(
      element.id,
      sectionId,
      e.clientX,
      e.clientY,
      transform.x,
      transform.y,
    );
  };

  // ── 텍스트 키보드 핸들러 (편집 중) ──────────────────────────────────────────
  const handleTextKeyDown = (e: React.KeyboardEvent) => {
    // 편집 중 키 이벤트는 전역 단축키로 전파하지 않음
    e.stopPropagation();

    if (e.key === 'Enter') {
      e.preventDefault();
      // <br> 삽입 (div 자동 생성 방지)
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      document.execCommand('insertLineBreak');
    }
    if (e.key === 'Escape') {
      exitEditMode(true);
    }
  };

  // ── Blur 핸들러 ─────────────────────────────────────────────────────────────
  const handleTextBlur = () => {
    if (isEditing) {
      exitEditMode(false);
    }
  };

  // ── 편집 중 실시간 높이 자동 조정 ────────────────────────────────────────────
  const handleTextInput = () => {
    const div = textDivRef.current;
    if (!div || !isEditing) return;
    // overflow 해제 후 scrollHeight 측정 → div 높이 실시간 반영 (시각 피드백)
    div.style.height = 'auto';
    div.style.overflow = 'visible';
    const naturalH = div.scrollHeight;
    const minH = Math.max(20, element.textProps?.fontSize ?? 16);
    div.style.height = `${Math.max(naturalH, minH)}px`;
    div.style.overflow = 'hidden';
  };

  // ── 외부 HTML 붙여넣기 시 sanitize ──────────────────────────────────────────
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    const plain = e.clipboardData.getData('text/plain');
    const sanitized = html ? sanitizeRichText(html) : plain.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    document.execCommand('insertHTML', false, sanitized);
  }, []);

  // ── 이미지 교체 핸들러 ──────────────────────────────────────────────────────
  const handleReplaceImage = useCallback(async (file: File) => {
    try {
      const token = await getToken();
      if (!token) return;
      const newUrl = await uploadImageViaSignedUrl(token, file);
      if (element.type === 'image' && element.imageProps) {
        updateElement(sectionId, element.id, {
          imageProps: { ...element.imageProps, src: newUrl, isUserUploaded: true },
        });
      } else if (element.type === 'framed-image' && element.framedImageProps) {
        updateElement(sectionId, element.id, {
          framedImageProps: { ...element.framedImageProps, src: newUrl, isUserUploaded: true },
        });
      }
      setImgError(false);
      const sections = useEditorStore.getState().document?.sections;
      if (sections) {
        commitHistory('이미지 교체', sections);
      }
    } catch (err) {
      console.error('이미지 교체 실패:', err);
    }
  }, [element, sectionId, updateElement, commitHistory, getToken]);

  // ── 호버 핸들러 ──────────────────────────────────────────────────────────────
  const handleMouseEnter = () => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    hoverTimeoutRef.current = setTimeout(() => setIsHovered(false), 150);
  };

  if (!element.isVisible) return null;

  // ── 공통 스타일 ──────────────────────────────────────────────────────────────
  const baseStyle: CSSProperties = {
    position: 'absolute',
    left: transform.x,
    top: transform.y,
    width: transform.width,
    height: transform.height,
    ...(transform.rotation !== 0 ? { transform: `rotate(${transform.rotation}deg)` } : {}),
    opacity: element.opacity,
    zIndex: (isDragging && isSelected) || isResizingThis ? Z_INDEX.dragging : element.zIndex,
    cursor: isEditing ? 'text' : isDragging ? 'grabbing' : element.isLocked ? 'default' : 'grab',
    boxSizing: 'border-box',
    overflow: 'hidden',
    pointerEvents: 'auto',
    outline: isSelected ? '1px solid transparent' : undefined,
    userSelect: isEditing ? 'text' : 'none',
    ...(element.shadow?.enabled && element.type !== 'text' ? (() => {
      const rad = (element.shadow.angle * Math.PI) / 180;
      const sx = Math.round(Math.sin(rad) * element.shadow.distance);
      const sy = Math.round(-Math.cos(rad) * element.shadow.distance);
      const shadowColor = element.shadow.color ?? 'rgba(0,0,0,0.3)';
      return { boxShadow: `${sx}px ${sy}px ${element.shadow.blur}px ${element.shadow.spread}px ${shadowColor}` };
    })() : {}),
  };

  // V4.5: 자동 높이 텍스트는 overflow:visible + height:auto
  if (isAutoHeight) {
    baseStyle.overflow = 'visible';
    const textMinH = Math.max(20, element.textProps?.fontSize ?? 16);
    baseStyle.minHeight = textMinH;
    baseStyle.height = 'auto';
  }

  // ── 도형 요소 ──────────────────────────────────────────────────────────────
  if (element.type === 'shape' && element.shapeProps) {
    const sp = element.shapeProps;

    // SVG 기반 도형 (triangle/star/arrow/speechBubble)
    const svgShapes = new Set(['triangle', 'star', 'arrow', 'speechBubble']);
    if (svgShapes.has(sp.shapeType)) {
      const fill = sp.fill || '#e5e7eb';
      const stroke = sp.stroke || 'none';
      const strokeWidth = sp.strokeWidth ?? 0;
      let shapeEl: React.ReactNode = null;
      if (sp.shapeType === 'triangle') {
        shapeEl = <polygon points="50,5 95,95 5,95" fill={fill} stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" />;
      } else if (sp.shapeType === 'star') {
        shapeEl = (
          <polygon
            points="50,5 61,38 96,38 68,59 79,93 50,72 21,93 32,59 4,38 39,38"
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinejoin="round"
          />
        );
      } else if (sp.shapeType === 'arrow') {
        shapeEl = (
          <polygon
            points="0,35 60,35 60,15 100,50 60,85 60,65 0,65"
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinejoin="round"
          />
        );
      } else if (sp.shapeType === 'speechBubble') {
        shapeEl = (
          <path
            d="M10,10 L90,10 Q95,10 95,15 L95,65 Q95,70 90,70 L45,70 L30,90 L33,70 L10,70 Q5,70 5,65 L5,15 Q5,10 10,10 Z"
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinejoin="round"
          />
        );
      }
      return (
        <div
          onPointerDown={handlePointerDown}
          onContextMenu={handleContextMenu}
          onClick={(e) => e.stopPropagation()}
          style={{ ...baseStyle, overflow: 'visible' }}
          data-shape=""
        >
          <svg
            width="100%"
            height="100%"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            style={{ display: 'block', pointerEvents: 'none' }}
          >
            {shapeEl}
          </svg>
        </div>
      );
    }

    // CSS 기반 도형 (rect/roundedRect/circle/ellipse/line/diamond)
    const isDiamond = sp.shapeType === 'diamond';
    const shapeStyle: CSSProperties = {
      ...baseStyle,
      overflow: 'visible',
      backgroundColor: sp.fill || 'transparent',
      ...(sp.stroke
        ? { border: `${sp.strokeWidth ?? 1}px solid ${sp.stroke}` }
        : {}),
      ...(sp.shapeType === 'circle' || sp.shapeType === 'ellipse'
        ? { borderRadius: '50%' }
        : sp.shapeType === 'roundedRect'
        ? {
            borderRadius: sp.borderRadii
              ? `${sp.borderRadii[0]}px ${sp.borderRadii[1]}px ${sp.borderRadii[2]}px ${sp.borderRadii[3]}px`
              : sp.borderRadius ?? 20,
          }
        : {}),
      ...(isDiamond
        ? {
            transform: `${baseStyle.transform ?? ''} rotate(45deg)`.trim(),
          }
        : {}),
    };
    return (
      <div
        onPointerDown={handlePointerDown}
        onContextMenu={handleContextMenu}
        onClick={(e) => e.stopPropagation()}
        style={shapeStyle}
        data-shape=""
      />
    );
  }

  // ── 뱃지 요소 (텍스트 + 배경 pill) ─────────────────────────────────────────
  if (element.type === 'badge') {
    const tp = element.textProps;
    const badgeBg = element.shapeProps?.fill || '#ef4444';
    return (
      <div
        onPointerDown={handlePointerDown}
        onContextMenu={handleContextMenu}
        onClick={(e) => e.stopPropagation()}
        style={{
          ...baseStyle,
          backgroundColor: badgeBg,
          color: tp?.color || '#ffffff',
          fontFamily: tp?.fontFamily || 'Pretendard',
          fontSize: tp?.fontSize ?? 24,
          fontWeight: tp?.fontWeight ?? 700,
          textAlign: (tp?.textAlign as CSSProperties['textAlign']) || 'center',
          borderRadius: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          letterSpacing: `${tp?.letterSpacing ?? 0}px`,
          padding: '0 16px',
          whiteSpace: 'nowrap',
        }}
      >
        {tp?.content || 'NEW'}
      </div>
    );
  }

  // ── 카드 그룹 요소 (Stub — 컬럼 수만큼 플레이스홀더 박스) ─────────────────
  if (element.type === 'card_group' && element.cardGroupProps) {
    const cg = element.cardGroupProps;
    const cols = cg.columns ?? cg.cards.length ?? 2;
    return (
      <div
        onPointerDown={handlePointerDown}
        onContextMenu={handleContextMenu}
        onClick={(e) => e.stopPropagation()}
        style={{
          ...baseStyle,
          display: 'grid',
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gap: 12,
          padding: 8,
        }}
      >
        {cg.cards.map((c) => (
          <div
            key={c.id}
            style={{
              background: '#f3f4f6',
              border: '1px dashed #d1d5db',
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#9ca3af',
              fontSize: 14,
              minHeight: 80,
            }}
          >
            {c.title || 'Card'}
          </div>
        ))}
      </div>
    );
  }

  // ── SVG 요소 ──────────────────────────────────────────────────────────────
  if (element.type === 'svg' && element.svgProps) {
    return (
      <div
        onPointerDown={handlePointerDown}
        onContextMenu={handleContextMenu}
        onClick={(e) => e.stopPropagation()}
        style={{ ...baseStyle, overflow: 'hidden' }}
        dangerouslySetInnerHTML={{ __html: element.svgProps.svgString }}
      />
    );
  }

  // ── 텍스트 요소 ──────────────────────────────────────────────────────────────
  // 수직 정렬 헬퍼
  const vAlign = element.verticalAlign ?? 'middle';
  const justifyMap = { top: 'flex-start', middle: 'center', bottom: 'flex-end' } as const;

  if (element.type === 'text' && element.textProps) {
    const { textProps } = element;
    return (
      <div
        ref={textDivRef}
        data-el={element.id}
        onPointerDown={handlePointerDown}
        onContextMenu={handleContextMenu}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={enterEditMode}
        onBlur={handleTextBlur}
        onKeyDown={handleTextKeyDown}
        onInput={handleTextInput}
        onPaste={handlePaste}
        suppressContentEditableWarning
        style={{
          ...baseStyle,
          fontFamily: `${textProps.fontFamily}, 'Pretendard Variable', sans-serif`,
          fontSize: textProps.fontSize,
          fontWeight: textProps.fontWeight,
          fontStyle: textProps.fontStyle,
          textDecoration: textProps.textDecoration,
          color: textProps.color,
          textAlign: textProps.textAlign,
          lineHeight: textProps.lineHeight,
          letterSpacing: `${textProps.letterSpacing}px`,
          // 수직 정렬 (autoHeight가 아닌 경우만)
          ...(!isAutoHeight ? {
            display: 'flex',
            flexDirection: 'column' as const,
            justifyContent: justifyMap[vAlign],
          } : {}),
          // 텍스트 외곽선
          ...(textProps.strokeWidth ? {
            paintOrder: 'stroke fill' as const,
            WebkitTextStroke: `${textProps.strokeWidth}px ${textProps.stroke || 'transparent'}`,
          } : {}),
          // 텍스트 그림자 (angle+distance → X/Y 변환, 색상 검정 고정)
          ...((textProps.textShadowDistance || textProps.textShadowBlur) ? (() => {
            const a = (textProps.textShadowAngle ?? 135) * Math.PI / 180;
            const d = textProps.textShadowDistance ?? 0;
            const shadowColor = textProps.textShadowColor ?? 'rgba(0,0,0,0.3)';
            return { textShadow: `${Math.round(Math.sin(a) * d)}px ${Math.round(-Math.cos(a) * d)}px ${textProps.textShadowBlur ?? 0}px ${shadowColor}` };
          })() : {}),
          wordBreak: 'keep-all',
          whiteSpace: 'pre-wrap',
          // §4-3b 균형 줄바꿈: 헤딩(≥60px)의 고아 줄 제거 — 줄 수는 불변이라 실측 높이와 충돌 없음
          ...(textProps.fontSize >= BALANCED_HEADING_MIN_FONT ? { textWrap: 'balance' as const } : {}),
          // 편집 모드에서는 선택 커서와 아웃라인 표시
          ...(isEditing ? { outline: '2px solid var(--editor-brand)', outlineOffset: '2px' } : {}),
        }}
      />
    );
  }

  // ── 이미지 요소 ──────────────────────────────────────────────────────────────
  if (element.type === 'image' && element.imageProps) {
    const { imageProps } = element;
    // 모서리 반경(옵션 카드 사진) — 내보내기 htmlBuilders와 같은 값. 굽기는 이 화면을 그대로 찍는다
    const radiusStyle: CSSProperties = imageProps.borderRadii
      ? { borderRadius: imageProps.borderRadii.map((r) => `${Number(r) || 0}px`).join(' ') }
      : {};

    if (imgError || !imageProps.src) {
      return (
        <div
          onPointerDown={handlePointerDown}
          onContextMenu={handleContextMenu}
          onClick={(e) => e.stopPropagation()}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          data-img-placeholder=""
          style={{
            ...baseStyle,
            ...radiusStyle,
            backgroundColor: '#f3f4f6',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12,
            color: '#9ca3af',
            textAlign: 'center',
            padding: 8,
            lineHeight: 1.4,
            flexDirection: 'column',
            gap: 4,
          }}
        >
          <span style={{ fontSize: 20 }}>🖼️</span>
          <span>{imageProps.alt || imageProps.imageType}</span>

          {!isEditing && pdpId && (
            <ImageActionToolbar
              isVisible={isHovered}
              imageSrc={imageProps.src || ''}
              imageAlt={imageProps.alt || imageProps.imageType || 'image'}
              onReplace={handleReplaceImage}
            />
          )}

        </div>
      );
    }

    const isCropping = cropTarget?.elementId === element.id;
    const cr = imageProps.cropRect;
    // cropRect가 있으면 이미지를 확대하여 잘린 영역만 보이게 함
    const cropImgStyle: React.CSSProperties = cr ? {
      position: 'absolute' as const,
      width: `${(100 / cr.width) * 100}%`,
      height: `${(100 / cr.height) * 100}%`,
      left: `${-(cr.x / cr.width) * 100}%`,
      top: `${-(cr.y / cr.height) * 100}%`,
      objectFit: 'cover' as const,
      display: 'block',
    } : {
      width: '100%',
      height: '100%',
      objectFit: imageProps.objectFit,
      objectPosition: `center ${vAlign === 'top' ? 'top' : vAlign === 'bottom' ? 'bottom' : 'center'}`,
      display: 'block',
    };

    return (
      <div
        onPointerDown={handlePointerDown}
        onContextMenu={handleContextMenu}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => {
          e.stopPropagation();
          if (!element.isLocked) setCropTarget({ elementId: element.id, sectionId });
        }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        style={{
          ...baseStyle,
          // 자르는 동안은 각지게 — 위 모서리 자르기 핸들이 반경 밖으로 잘리지 않게
          ...(isCropping ? {} : radiusStyle),
          position: 'absolute',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={motionSrc ?? imageProps.src}
          alt={imageProps.alt}
          loading="eager"
          draggable={false}
          onError={onPhotoError}
          data-motion-preview={motionSrc ? '' : undefined}
          style={cropImgStyle}
        />

        {!isEditing && pdpId && (
          <ImageActionToolbar
            isVisible={isHovered}
            imageSrc={imageProps.src}
            imageAlt={imageProps.alt || imageProps.imageType || 'image'}
            onReplace={handleReplaceImage}
            onCrop={element.type === 'image' ? () => setCropTarget({ elementId: element.id, sectionId }) : undefined}
          />
        )}


        {isCropping && (
          <ImageCropOverlay
            elementId={element.id}
            sectionId={sectionId}
            imageSrc={imageProps.src}
            initialCrop={cr}
            containerWidth={transform.width}
            containerHeight={transform.height}
            zoom={zoom}
            objectFit={imageProps.objectFit}
          />
        )}
      </div>
    );
  }

  // ── 프레임 이미지 요소 (Hero clipPath 이미지) ────────────────────────────────
  if (element.type === 'framed-image' && element.framedImageProps) {
    const { framedImageProps } = element;

    // 프레임 모양 → CSS 스타일 변환
    const frameId = framedImageProps.frameId;
    const frameStyle: CSSProperties =
      frameId === 'circle'
        ? { borderRadius: '50%', overflow: 'hidden' }
        : frameId === 'roundedRect'
        ? {
            // K 컨셉 사진 반경(cornerRadius) — 숫자가 아니면 기본 16(내보내기 htmlBuilders와 같은 판정)
            borderRadius:
              typeof framedImageProps.cornerRadius === 'number' && Number.isFinite(framedImageProps.cornerRadius) && framedImageProps.cornerRadius >= 0
                ? framedImageProps.cornerRadius
                : 16,
            overflow: 'hidden',
          }
        : frameId === 'rect'
        ? { overflow: 'hidden' }
        : // 기타(Hero clipPath 등) — clipPath 문자열 사용
          {
            ...(framedImageProps.clipPath && framedImageProps.clipPath !== 'none'
              ? { clipPath: framedImageProps.clipPath }
              : {}),
            overflow: 'hidden',
          };

    // 테두리 (clipPath 사용 프레임에서는 클립으로 잘리므로 미적용)
    const usesClipPath =
      frameId !== 'circle' && frameId !== 'roundedRect' && frameId !== 'rect';
    if (!usesClipPath && framedImageProps.borderWidth && framedImageProps.borderWidth > 0) {
      frameStyle.border = `${framedImageProps.borderWidth}px ${framedImageProps.borderStyle ?? 'solid'} ${framedImageProps.borderColor ?? '#000000'}`;
      frameStyle.boxSizing = 'border-box';
    }

    if (imgError || !framedImageProps.src) {
      return (
        <div
          onPointerDown={handlePointerDown}
          onContextMenu={handleContextMenu}
          onClick={(e) => e.stopPropagation()}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          data-img-placeholder=""
          style={{
            ...baseStyle,
            ...frameStyle,
            backgroundColor: '#f3f4f6',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12,
            color: '#9ca3af',
            textAlign: 'center',
            padding: 8,
            lineHeight: 1.4,
            flexDirection: 'column',
            gap: 4,
          }}
        >
          <span style={{ fontSize: 20 }}>🖼️</span>
          <span>{framedImageProps.alt || framedImageProps.imageType}</span>

          {!isEditing && pdpId && (
            <ImageActionToolbar
              isVisible={isHovered}
              imageSrc={framedImageProps.src || ''}
              imageAlt={framedImageProps.alt || framedImageProps.imageType || 'image'}
              onReplace={handleReplaceImage}
            />
          )}
        </div>
      );
    }

    const isCroppingFramed = cropTarget?.elementId === element.id;
    const fcr = framedImageProps.cropRect;
    // cropRect가 있으면 이미지를 확대하여 잘린 영역만 보이게 함
    const framedCropStyle: React.CSSProperties = fcr ? {
      position: 'absolute' as const,
      width: `${(100 / fcr.width) * 100}%`,
      height: `${(100 / fcr.height) * 100}%`,
      left: `${-(fcr.x / fcr.width) * 100}%`,
      top: `${-(fcr.y / fcr.height) * 100}%`,
      objectFit: 'cover' as const,
      display: 'block',
    } : {
      width: '100%',
      height: '100%',
      objectFit: (framedImageProps.objectFit as CSSProperties['objectFit']) || 'cover',
      objectPosition: `center ${vAlign === 'top' ? 'top' : vAlign === 'bottom' ? 'bottom' : 'center'}`,
      display: 'block',
    };

    return (
      <div
        onPointerDown={handlePointerDown}
        onContextMenu={handleContextMenu}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => {
          e.stopPropagation();
          if (!element.isLocked) setCropTarget({ elementId: element.id, sectionId });
        }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        style={{ ...baseStyle, ...frameStyle }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={motionSrc ?? framedImageProps.src}
          alt={framedImageProps.alt}
          loading="eager"
          draggable={false}
          onError={onPhotoError}
          data-motion-preview={motionSrc ? '' : undefined}
          style={framedCropStyle}
        />

        {!isEditing && pdpId && (
          <ImageActionToolbar
            isVisible={isHovered}
            imageSrc={framedImageProps.src}
            imageAlt={framedImageProps.alt || framedImageProps.imageType || 'image'}
            onReplace={handleReplaceImage}
            onCrop={() => setCropTarget({ elementId: element.id, sectionId })}
          />
        )}


        {isCroppingFramed && (
          <ImageCropOverlay
            elementId={element.id}
            sectionId={sectionId}
            imageSrc={framedImageProps.src}
            initialCrop={fcr}
            containerWidth={transform.width}
            containerHeight={transform.height}
            zoom={zoom}
            objectFit={(framedImageProps.objectFit as 'cover' | 'contain' | 'fill') || 'cover'}
          />
        )}
      </div>
    );
  }

  return null;
}
