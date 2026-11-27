// sectionConverter/svg.ts — D1 분할: 원본 sectionConverter.ts 47~97행, 392~422행 순수 이동 (2026-07-04)


// ─────────────────────────────────────────────────────────────────────────────
// c13: USP SVG 라인아트 아이콘 매핑 — 80×80 굵은 라인 일러스트
// ─────────────────────────────────────────────────────────────────────────────
const USP_ICON_MAP: Array<{ keywords: string[]; paths: string }> = [
  {
    keywords: ['정전기', '전기', '스파크', '마찰'],
    // 번개 지그재그 — stroke 4.5px 명확한 라인
    paths: '<path d="M46 8L30 36h20L30 72" stroke="{c}" stroke-width="4.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  {
    keywords: ['지압', '마사지', '압', '자극'],
    // 이중 원 + 위 화살표 — 지압 표현
    paths: '<circle cx="40" cy="46" r="22" stroke="{c}" stroke-width="3.5" fill="none"/><circle cx="40" cy="46" r="12" stroke="{c}" stroke-width="2.5" fill="none"/><path d="M40 8v14" stroke="{c}" stroke-width="3.5" fill="none" stroke-linecap="round"/><path d="M34 16l6-9 6 9" stroke="{c}" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  {
    keywords: ['커버', '넓은', '범위', '두피', '어깨', '크기'],
    // 반원 + 방사선 — 넓은 커버리지
    paths: '<path d="M12 60C12 32 24 12 40 12C56 12 68 32 68 60" stroke="{c}" stroke-width="3.5" fill="none" stroke-linecap="round"/><line x1="12" y1="60" x2="68" y2="60" stroke="{c}" stroke-width="3" stroke-linecap="round"/><line x1="40" y1="12" x2="40" y2="34" stroke="{c}" stroke-width="2" stroke-linecap="round" opacity="0.5"/><line x1="22" y1="28" x2="30" y2="40" stroke="{c}" stroke-width="2" stroke-linecap="round" opacity="0.5"/><line x1="58" y1="28" x2="50" y2="40" stroke="{c}" stroke-width="2" stroke-linecap="round" opacity="0.5"/>',
  },
  {
    keywords: ['원목', '나무', '천연', '소재', '목재'],
    // 나무 형태 — 트렁크 + 가지
    paths: '<path d="M40 68V36M24 52l16-16 16 16M20 36l20-24 20 24" stroke="{c}" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  {
    keywords: ['활용', '다용도', '편리', '간편', '사용'],
    // 4개 사각 그리드 — 다용도 표현
    paths: '<rect x="14" y="14" width="22" height="22" rx="4" stroke="{c}" stroke-width="3" fill="none"/><rect x="44" y="14" width="22" height="22" rx="4" stroke="{c}" stroke-width="3" fill="none"/><rect x="14" y="44" width="22" height="22" rx="4" stroke="{c}" stroke-width="3" fill="none"/><rect x="44" y="44" width="22" height="22" rx="4" stroke="{c}" stroke-width="3" fill="none"/>',
  },
  {
    keywords: ['촉감', '부드', '실크', '매끄'],
    // 물결 2줄 — 부드러운 촉감
    paths: '<path d="M12 30 Q22 18 32 30 Q42 42 52 30 Q62 18 72 30" stroke="{c}" stroke-width="3.5" fill="none" stroke-linecap="round"/><path d="M12 46 Q22 34 32 46 Q42 58 52 46 Q62 34 72 46" stroke="{c}" stroke-width="2.5" fill="none" stroke-linecap="round" opacity="0.55"/>',
  },
  {
    keywords: ['그립', '손', '잡', '핸들'],
    // 손 잡는 형태 — 곡선 핸들
    paths: '<path d="M24 60C20 44 24 28 34 22C44 16 56 20 58 34" stroke="{c}" stroke-width="3.5" fill="none" stroke-linecap="round"/><path d="M58 34C60 46 54 56 46 60" stroke="{c}" stroke-width="3.5" fill="none" stroke-linecap="round"/><circle cx="40" cy="44" r="10" stroke="{c}" stroke-width="2.5" fill="none"/>',
  },
];
const USP_ICON_DEFAULT = '<circle cx="40" cy="40" r="18" stroke="{c}" stroke-width="3" fill="none"/><path d="M30 40l8 8 14-14" stroke="{c}" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>';

function getUSPSvgString(title: string, color: string): string {
  for (const { keywords, paths } of USP_ICON_MAP) {
    if (keywords.some((kw) => title.includes(kw))) {
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">${paths.replace(/\{c\}/g, color)}</svg>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">${USP_ICON_DEFAULT.replace(/\{c\}/g, color)}</svg>`;
}


// ─────────────────────────────────────────────────────────────────────────────
// SVG helpers
// ─────────────────────────────────────────────────────────────────────────────

/** SVG 별점 문자열 빌드 (buildStarsSvg) */
function buildStarsSvg(
  rating: number,
  opts: { size: number; color: string; gap: number },
): string {
  const { size, color, gap } = opts;
  const totalWidth = size * 5 + gap * 4;
  const starPath =
    'M12 2l2.9 6.3L22 9.2l-5 5.2L18.2 22 12 18.5 5.8 22 7 14.4 2 9.2l7.1-.9L12 2z';
  let stars = '';
  for (let i = 0; i < 5; i++) {
    const x = i * (size + gap);
    const fill = i < Math.floor(rating) ? color : `${color}30`;
    stars += `<svg x="${x}" y="0" width="${size}" height="${size}" viewBox="0 0 24 24">` +
      `<path d="${starPath}" fill="${fill}"/></svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${size}">${stars}</svg>`;
}

/** 세로 라인 + 점 장식 SVG 문자열 빌드 */
function buildVLineDotSvg(color: string, h: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 ${h}">` +
    `<line x1="5" y1="0" x2="5" y2="${h}" stroke="${color}" stroke-width="2" opacity="0.5"/>` +
    `<circle cx="5" cy="${Math.floor(h / 2)}" r="4" fill="${color}"/>` +
    `</svg>`;
}


export { getUSPSvgString, buildStarsSvg, buildVLineDotSvg };
