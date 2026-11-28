/**
 * 섹션 리플로우 규칙 — 글자 실측 높이(measuredHeight)로 글자·아래 요소·컨테이너·섹션 높이를 다시 맞춘다. 섹션을 제자리에서 바꾼다.
 * 편집기 스토어(reflowSection, immer 초안)와 보기 전용 뷰어(viewerReflow, 복제본)가 같이 쓴다 — 규칙은 여기 하나뿐이다.
 */

import type { CanvasElement, CanvasSection } from '@/lib/registration/editor/types/canvas';
import { SPACING } from '@/lib/registration/editor/constants/designTokens';

/** 행 상자의 칸 — 가로로 겹치는 식구끼리 한 칸이다(좌우 표는 이름·값 두 칸, 쌓기 항목은 이름·값 한 칸) */
function columnsOf(kids: CanvasElement[]): CanvasElement[][] {
  const cols: CanvasElement[][] = [];
  for (const k of [...kids].sort((a, b) => a.transform.x - b.transform.x)) {
    const overlaps = (o: CanvasElement) =>
      o.transform.x < k.transform.x + k.transform.width && k.transform.x < o.transform.x + o.transform.width;
    const col = cols.find((c) => c.some(overlaps));
    if (col) col.push(k);
    else cols.push([k]);
  }
  return cols;
}
const spanOf = (col: CanvasElement[]) => ({
  top: Math.min(...col.map((e) => e.transform.y)),
  bottom: Math.max(...col.map((e) => e.transform.y + e.transform.height)),
});
const kidsOf = (c: CanvasElement, elById: Map<string, CanvasElement>) =>
  c.containerOf!.map((id) => elById.get(id)).filter((e): e is CanvasElement => Boolean(e));
/** 행 내용 높이 — 칸마다 위 끝~아래 끝 중 가장 큰 값 */
const contentOf = (c: CanvasElement, elById: Map<string, CanvasElement>) =>
  Math.max(0, ...columnsOf(kidsOf(c, elById)).map((col) => spanOf(col).bottom - spanOf(col).top));

/**
 * 표 행 묶음 높이(K10) — 묶음마다 실측 내용 높이를 재서, 가장 낮은 행보다 한 줄(식구 글의 가장 큰 줄 높이) 높은 행까지를 같은 높이로 본다.
 * 그보다 긴 행은 제 높이다(centerRow가 제 내용과 큰 쪽을 쓴다)
 */
function groupRowHeights(containers: CanvasElement[], elById: Map<string, CanvasElement>): Map<string, number> {
  const groups = new Map<string, CanvasElement[]>();
  for (const c of containers) if (c.rowGroup) groups.set(c.rowGroup, [...(groups.get(c.rowGroup) ?? []), c]);
  const out = new Map<string, number>();
  for (const [id, rows] of groups) {
    const contents = rows.map((r) => contentOf(r, elById));
    const line = Math.max(
      0,
      ...rows.flatMap((r) => kidsOf(r, elById).map((k) => (k.textProps ? k.textProps.fontSize * (k.textProps.lineHeight ?? 1) : 0))),
    );
    const low = Math.min(...contents);
    out.set(id, Math.max(...contents.filter((h) => h <= low + line + 1)));
  }
  return out;
}

/** 행을 묶음 높이(또는 더 긴 제 내용)로 세우고 칸마다 세로 가운데에 다시 둔다 — 새 높이를 돌려준다 */
function centerRow(c: CanvasElement, elById: Map<string, CanvasElement>, rowH: number): number {
  const height = Math.max(rowH, contentOf(c, elById));
  for (const col of columnsOf(kidsOf(c, elById))) {
    const { top, bottom } = spanOf(col);
    const shift = Math.round(c.transform.y + (height - (bottom - top)) / 2 - top);
    for (const k of col) k.transform.y += shift;
  }
  return height;
}

export function reflowSectionLayout(section: CanvasSection): void {
  // ── 섹션 하단 패딩 보존 (컨테이너 pad와 동일한 멱등 방식) ──────────────
  // 변환(computeSectionHeight)·프리셋 적용이 부여한 하단 여백이 초기 리플로우
  // 에서 소거되지 않게, 성장 전 기하 기준 pad를 기록해 최종 높이에 되살린다.
  // 상한 = 정본 토큰: 프리셋 estimatedHeight의 큰 슬랙은 기존처럼 축소 허용.
  // 구저장본(pad 0)은 0이 보존되므로 소급 변경 없음.
  let initialMaxBottom = 0;
  for (const el of section.elements) {
    const b = el.transform.y + el.transform.height;
    if (b > initialMaxBottom) initialMaxBottom = b;
  }
  const bottomPad = Math.max(0, section.canvas.height - initialMaxBottom);
  // K 템플릿은 자기 spacing으로 끝나므로 그대로 둔다(토큰 값으로 줄이면 경계 규격 240~260이 깨진다)
  const preservedBottomPad = section.preserveBottomPad ? bottomPad : Math.min(SPACING.sectionBottomPadding, bottomPad);

  // ── 컨테이너 관계 사전 산출 ─────────────────────────────────────────
  // 컨테이너의 "하단 패딩"(현재 기하 기준 bottom - 최하단 자식 bottom)을
  // 미리 기록해 두고, 텍스트 성장 후 fit 패스에서 자식+패딩으로 재계산한다.
  // (기존 += deltaH 누적 방식은 재로드마다 성장이 중복 적용될 수 있었다)
  const containers = section.elements.filter(
    (e: CanvasElement) => e.containerOf && e.containerOf.length > 0,
  );
  const elById = new Map(section.elements.map((e: CanvasElement) => [e.id, e]));
  // ── 상자 안 상자 ── 다른 상자의 식구인 상자는 안쪽 상자다(K 띠 안 표 행·캡슐 바탕·이름표). 글 밀기는 가장 안쪽
  // 상자 안에서만, 맞춤은 안쪽 상자부터 하고 그 이동은 부모 식구 안에서만 한다 — 바깥으로는 부모 맞춤이 한 번 전한다.
  // 안쪽 상자가 없으면 전과 같다.
  const containerIds = new Set(containers.map((c: CanvasElement) => c.id));
  const parentsOf = new Map<string, CanvasElement[]>();
  for (const c of containers) {
    for (const id of c.containerOf!) {
      if (containerIds.has(id) && id !== c.id) parentsOf.set(id, [...(parentsOf.get(id) ?? []), c]);
    }
  }
  const depthOf = (c: CanvasElement, seen: Set<string> = new Set()): number => {
    const parents = (parentsOf.get(c.id) ?? []).filter((p) => !seen.has(p.id));
    if (parents.length === 0) return 0;
    const next = new Set([...seen, c.id]);
    return 1 + Math.max(...parents.map((p) => depthOf(p, next)));
  };
  // 상자 밖으로 내민 장식(overhang, K 띠 곡선 덮개)은 높이 맞춤에서 뺀다 — 넣으면 내민 만큼 상자가 커진다. 밀기는 다른 식구와 같다
  const fits = (child: CanvasElement | undefined): child is CanvasElement => Boolean(child && !child.overhang);
  const containerPad = new Map<string, number>();
  for (const c of containers) {
    let maxChildBottom = -Infinity;
    for (const id of c.containerOf!) {
      const child = elById.get(id);
      if (fits(child)) maxChildBottom = Math.max(maxChildBottom, child.transform.y + child.transform.height);
    }
    if (maxChildBottom > -Infinity) {
      // 음수 패딩(자식이 이미 컨테이너를 뚫은 구저장본)은 0으로 치유
      containerPad.set(c.id, Math.max(0, c.transform.y + c.transform.height - maxChildBottom));
    }
  }

  // y 기준 오름차순 정렬된 인덱스 배열
  const sorted = [...section.elements]
    .map((el, idx) => ({ el, idx }))
    .sort((a, b) => a.el.transform.y - b.el.transform.y);

  for (const { el } of sorted) {
    // autoHeight 텍스트 요소만 처리 (undefined도 true로 취급)
    if (el.type !== 'text' || el.autoHeight === false) continue;
    const measured = el.measuredHeight;
    if (!measured || measured <= 0) continue;

    const origH = el.transform.height;
    const minTextH = 20;
    const effectiveH = Math.max(measured, minTextH);
    const deltaH = effectiveH - origH;
    if (deltaH === 0) continue;

    // 표류 감시 가드 — 대형 delta는 폰트 미로딩 측정/추정기 오차 회귀 신호.
    // 레이아웃 정확성을 위해 적용은 하되 원인 추적용으로 경고를 남긴다.
    if (Math.abs(deltaH) > 120) {
      console.warn(
        `[reflowSection] 대형 높이 표류 감지: ${el.id} ${origH}→${effectiveH}px (Δ${deltaH})`,
      );
    }

    // 높이 갱신
    el.transform.height = effectiveH;

    const threshold = el.transform.y + origH;
    const allContainers = containers.filter((c: CanvasElement) => c.containerOf!.includes(el.id));
    // 가장 안쪽 상자 — 내 다른 상자를 식구로 둔 바깥 상자는 뺀다
    const myContainers = allContainers.filter(
      (c: CanvasElement) => !allContainers.some((d: CanvasElement) => d !== c && c.containerOf!.includes(d.id)),
    );

    if (myContainers.length > 0) {
      // 컨테이너 내부 텍스트: 밀어내기를 같은 컨테이너의 형제(threshold 이하)로
      // 한정한다. 컨테이너 밖 전파는 fit 패스가 bottom 변화분으로 1회 수행 —
      // 이웃 그리드 셀(USP 2×2)·같은 카드 상단(별점/이름)은 건드리지 않는다.
      const siblings = new Set<string>();
      for (const c of myContainers) {
        c.containerOf!.forEach((id: string) => siblings.add(id));
      }
      for (const other of section.elements) {
        if (other.id === el.id || !siblings.has(other.id)) continue;
        if (other.transform.y >= threshold) {
          other.transform.y += deltaH;
        }
      }
    } else {
      // 컨테이너 밖 텍스트(섹션 타이틀 등): 아래 전체를 균등 이동 —
      // 카드/셀은 통째로 함께 이동하므로 내부 정합이 유지된다
      for (const other of section.elements) {
        if (other.id === el.id) continue;
        if (other.transform.y >= threshold) {
          other.transform.y += deltaH;
        }
      }
    }
  }

  // ── 표 행 묶음(K10) ── 같은 rowGroup 행 상자를 실측 내용 높이로 다시 맞춘다(fit 패스가 행 높이·가운데로 쓴다)
  const rowHeights = groupRowHeights(containers, elById);

  // ── 컨테이너 fit 패스 ──────────────────────────────────────────────
  // 자식 최하단 + 보존된 패딩으로 컨테이너 높이를 재계산한다 (멱등).
  // bottom 변화분은 컨테이너 아래 요소에 1회 전파 — 동일 자식 집합을
  // 공유하는 컨테이너(스텝 bg/보더)는 서명으로 중복 전파를 방지한다.
  const shiftedSignatures = new Set<string>();
  // 안쪽 상자부터(깊이 큰 순), 같은 깊이는 위에서부터
  const depth = new Map(containers.map((c: CanvasElement) => [c.id, depthOf(c)]));
  const containersByY = [...containers].sort(
    (a, b) => depth.get(b.id)! - depth.get(a.id)! || a.transform.y - b.transform.y,
  );
  for (const c of containersByY) {
    const pad = containerPad.get(c.id);
    if (pad === undefined) continue;
    let maxChildBottom = -Infinity;
    for (const id of c.containerOf!) {
      const child = elById.get(id);
      if (fits(child)) maxChildBottom = Math.max(maxChildBottom, child.transform.y + child.transform.height);
    }
    if (maxChildBottom === -Infinity) continue;

    const oldBottom = c.transform.y + c.transform.height;
    // 표 행(K10) — 묶음 높이와 제 내용 중 큰 쪽으로 세우고 칸마다 가운데에 다시 둔다. 묶음이 없으면 전과 같다
    const rowH = c.rowGroup ? rowHeights.get(c.rowGroup) : undefined;
    const newH = rowH !== undefined ? centerRow(c, elById, rowH) : Math.max(20, maxChildBottom + pad - c.transform.y);
    const dBottom = c.transform.y + newH - oldBottom;
    c.transform.height = newH;

    if (dBottom !== 0) {
      const signature = [...c.containerOf!].sort().join(',');
      if (!shiftedSignatures.has(signature)) {
        shiftedSignatures.add(signature);
        const children = new Set(c.containerOf!);
        // 안쪽 상자는 부모 식구 안에서만 옮긴다 — 부모 맞춤이 바깥으로 한 번 전한다
        const parents = parentsOf.get(c.id) ?? [];
        const within = parents.length > 0 ? new Set(parents.flatMap((p) => p.containerOf!)) : null;
        for (const other of section.elements) {
          if (other.id === c.id || children.has(other.id)) continue;
          if (within && !within.has(other.id)) continue;
          if (other.transform.y >= oldBottom - 0.5) {
            other.transform.y += dBottom;
          }
        }
      }
    }
  }

  // 섹션 높이 재계산
  let maxBottom = 0;
  for (const el of section.elements) {
    const bottom = el.transform.y + el.transform.height;
    if (bottom > maxBottom) maxBottom = bottom;
  }
  const MIN_SECTION_HEIGHT = 200;
  if (!section.userAdjustedHeight) {
    // 요소 bounds + 보존된 하단 패딩으로 확장 AND 축소
    section.canvas.height = Math.max(MIN_SECTION_HEIGHT, maxBottom + preservedBottomPad);
  } else {
    // 사용자 조정 높이 유지, 단 요소 overflow 방지
    section.canvas.height = Math.max(section.canvas.height, maxBottom);
  }
}
