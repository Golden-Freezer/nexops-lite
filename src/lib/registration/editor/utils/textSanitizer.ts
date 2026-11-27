// ─── Rich Text Sanitizer ────────────────────────────────────────────────────
// <span style="font-size:...;color:..."> + <br> 만 허용, 나머지 태그 제거

const ALLOWED_SPAN_RE = /<span\s+style="([^"]*)">([\s\S]*?)<\/span>/gi;
const BR_RE = /<br\s*\/?>/gi;
const ANY_TAG_RE = /<\/?[^>]+(>|$)/g;

/** span style에서 font-size / color만 추출 */
function sanitizeSpanStyle(raw: string): string {
  const parts: string[] = [];
  const fsMatch = raw.match(/font-size\s*:\s*([^;]+)/i);
  if (fsMatch) parts.push(`font-size:${fsMatch[1].trim()}`);
  const cMatch = raw.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i);
  if (cMatch) parts.push(`color:${cMatch[1].trim()}`);
  return parts.join(';');
}

/**
 * HTML에서 허용된 태그(<span style="font-size:...;color:...">, <br>)만 남기고 나머지 제거.
 * XSS 방지를 위해 허용되지 않은 태그/속성은 모두 strip.
 */
export function sanitizeRichText(html: string): string {
  // 1. span 태그를 플레이스홀더로 치환
  const spans: string[] = [];
  let temp = html.replace(ALLOWED_SPAN_RE, (_match, style: string, inner: string) => {
    const clean = sanitizeSpanStyle(style);
    if (!clean) {
      // 스타일 없으면 span 제거하고 내용만
      spans.push(inner);
    } else {
      spans.push(`<span style="${clean}">${inner}</span>`);
    }
    return `\x00SPAN${spans.length - 1}\x00`;
  });

  // 2. <br> 플레이스홀더
  temp = temp.replace(BR_RE, '\x00BR\x00');

  // 3. 나머지 태그 모두 제거
  temp = temp.replace(ANY_TAG_RE, '');

  // 4. 플레이스홀더 복원
  temp = temp.replace(/\x00BR\x00/g, '<br>');
  temp = temp.replace(/\x00SPAN(\d+)\x00/g, (_m, idx) => spans[parseInt(idx)] ?? '');

  return temp;
}

/**
 * HTML 엔티티 디코드 — contentEditable의 innerHTML은 &, <, >, 연속 공백을
 * &amp;/&lt;/&gt;/&nbsp;로 인코딩해 돌려주므로, plain text로 되돌릴 때
 * 반드시 복원해야 한다. (미복원 시 "A & B" 편집 → "A &amp; B" 저장 오염)
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, '&'); // 이중 인코딩 방지 위해 마지막에 처리
}

/** 태그 제거 + 엔티티 디코드 → plain text (content 동기화용) */
export function richTextToPlainText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(BR_RE, '\n')
      .replace(ANY_TAG_RE, ''),
  );
}

/** 인접 동일 스타일 span 병합, 빈 span 제거 */
export function normalizeRichText(html: string): string {
  // 빈 span 제거
  let result = html.replace(/<span\s+style="[^"]*"><\/span>/gi, '');

  // 인접 동일 스타일 span 병합
  let prev = '';
  while (prev !== result) {
    prev = result;
    result = result.replace(
      /<span\s+style="([^"]*)">([\s\S]*?)<\/span><span\s+style="([^"]*)">([\s\S]*?)<\/span>/gi,
      (_m, s1: string, c1: string, s2: string, c2: string) => {
        if (s1 === s2) return `<span style="${s1}">${c1}${c2}</span>`;
        return _m;
      }
    );
  }

  return result;
}
