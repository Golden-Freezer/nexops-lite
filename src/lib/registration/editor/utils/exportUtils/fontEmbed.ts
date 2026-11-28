// exportUtils/fontEmbed.ts — 내보내기 캡처용 글꼴 임베드(U1b, 2026-10-27)
//
// dom-to-image-more는 toBlob 한 번마다 페이지의 모든 @font-face(편집기 글꼴 선택용 Google Fonts 한글 subset 전부)를
// 다시 받아 SVG에 넣는다(렌더마다 자원 캐시를 비운다). 섹션마다 찍으면 수천 건 요청이 몰려 실패하고 느리다
// (U1 E2E 실측: 굽기 276초, 실패 요청 약 2,900, ERR_INSUFFICIENT_RESOURCES).
// 그래서 찍을 노드에 실제로 쓰인 글꼴·글자가 든 유니코드 범위의 @font-face만 골라 한 번 받아 두고(페이지 단위 캐시),
// 캡처 때 <style>로 넣은 뒤 disableEmbedFonts로 찍는다. 순수 계산(범위·선택)은 위쪽, 브라우저 동작은 아래쪽.

export type CodeRange = [number, number]

/** "U+AC00-D7A3, U+0041, U+4??" → 범위 목록. 없거나 읽을 수 없으면 null(전 범위로 본다) */
export function parseUnicodeRange(value: string | null | undefined): CodeRange[] | null {
  if (!value || !value.trim()) return null
  const ranges: CodeRange[] = []
  for (const part of value.split(',')) {
    const m = /^\s*U\+([0-9A-F?]{1,6})(?:-([0-9A-F]{1,6}))?\s*$/i.exec(part)
    if (!m) continue
    if (m[1].includes('?')) {
      ranges.push([parseInt(m[1].replace(/\?/g, '0'), 16), parseInt(m[1].replace(/\?/g, 'F'), 16)])
    } else {
      const start = parseInt(m[1], 16)
      const end = m[2] ? parseInt(m[2], 16) : start
      if (end >= start) ranges.push([start, end])
    }
  }
  return ranges.length > 0 ? ranges : null
}

export function rangesHit(ranges: CodeRange[] | null, codePoints: ReadonlySet<number>): boolean {
  if (!ranges) return true
  for (const cp of codePoints) if (ranges.some(([a, b]) => cp >= a && cp <= b)) return true
  return false
}

/** font-family 값의 이름들(따옴표 제거·소문자) */
export function familyNames(value: string | null | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((f) =>
      f
        .trim()
        .replace(/^["']|["']$/g, '')
        .toLowerCase()
    )
    .filter(Boolean)
}

export interface FontFaceLike {
  family: string
  unicodeRange: string | null
  cssText: string
  baseUrl: string | null
}

/** 쓰인 글꼴 이름·글자에 맞는 @font-face만 고른다 */
export function selectFontFaces(
  faces: readonly FontFaceLike[],
  used: { families: ReadonlySet<string>; codePoints: ReadonlySet<number> }
): FontFaceLike[] {
  return faces.filter(
    (f) =>
      familyNames(f.family).some((n) => used.families.has(n)) &&
      rangesHit(parseUnicodeRange(f.unicodeRange), used.codePoints)
  )
}

const URL_TOKEN = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g

/** @font-face 안 url(...) 값(data: 제외, 중복 제거) */
export function fontUrls(cssText: string): string[] {
  const urls = [...cssText.matchAll(URL_TOKEN)].map((m) => m[2].trim()).filter((u) => !u.startsWith('data:'))
  return [...new Set(urls)]
}

/** url(...) 토큰 단위로 바꾼다(문자열 통째 치환은 a.woff가 a.woff2를 깨뜨린다) — 바꿀 값이 없는 url은 그대로 */
export function replaceFontUrls(cssText: string, inlined: ReadonlyMap<string, string>): string {
  return cssText.replace(URL_TOKEN, (token, quote: string, raw: string) => {
    const data = inlined.get(raw.trim())
    return data ? `url(${quote}${data}${quote})` : token
  })
}

// ─────────────────────────────────────────────
// 브라우저
// ─────────────────────────────────────────────

/**
 * 노드 안 글자에 쓰인 글꼴 이름과 코드 포인트. 텍스트 노드만 본다 — 의사 요소 content·말줄임표(text-overflow)·input 값의 글자는
 * 세지 않는다(편집기 캔버스에는 없다). 그런 글자가 다른 subset에만 있으면 그 글자만 대체 글꼴로 그려진다.
 */
export function usedTextProfile(root: HTMLElement): { families: Set<string>; codePoints: Set<number> } {
  const families = new Set<string>()
  const codePoints = new Set<number>()
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? ''
    if (!text.trim() || !node.parentElement) continue
    familyNames(getComputedStyle(node.parentElement).fontFamily).forEach((n) => families.add(n))
    for (const ch of text) codePoints.add(ch.codePointAt(0)!)
  }
  return { families, codePoints }
}

/** 읽을 수 있는 스타일시트의 @font-face(교차 출처 시트는 cssRules를 못 읽어 건너뛴다 — dom-to-image도 같다) */
function documentFontFaces(): FontFaceLike[] {
  const faces: FontFaceLike[] = []
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      continue
    }
    for (const rule of Array.from(rules)) {
      if (rule.type !== CSSRule.FONT_FACE_RULE) continue
      const style = (rule as CSSFontFaceRule).style
      faces.push({
        family: style.getPropertyValue('font-family'),
        unicodeRange: style.getPropertyValue('unicode-range') || null,
        cssText: rule.cssText,
        baseUrl: sheet.href,
      })
    }
  }
  return faces
}

/** 글꼴 파일 하나를 기다리는 한도 — 요청 하나가 멈춰도 굽기 전체가 멈추지 않게(라이브러리 기본 httpTimeout과 같은 30초) */
const FONT_FETCH_TIMEOUT_MS = 30_000

/** 글꼴 파일 data URL 캐시(페이지 단위) — 같은 파일은 한 번만 받는다. 실패는 캐시하지 않는다(다음 캡처가 다시 받는다) */
const fontDataCache = new Map<string, Promise<string | null>>()

function fetchAsDataUrl(url: string): Promise<string | null> {
  let hit = fontDataCache.get(url)
  if (!hit) {
    hit = fetch(url, { signal: AbortSignal.timeout(FONT_FETCH_TIMEOUT_MS) })
      .then((r) => (r.ok ? r.blob() : null))
      .then(
        (blob) =>
          blob &&
          new Promise<string | null>((resolve) => {
            const reader = new FileReader()
            reader.onload = () => resolve(String(reader.result))
            reader.onerror = () => resolve(null)
            reader.readAsDataURL(blob)
          })
      )
      .catch(() => null)
      .then((data) => {
        if (!data) {
          fontDataCache.delete(url)
          console.warn(`[Export] 글꼴 파일을 받지 못해 대체 글꼴로 그립니다: ${url}`)
        }
        return data
      })
    fontDataCache.set(url, hit)
  }
  return hit
}

function absoluteUrl(raw: string, baseUrl: string | null): string | null {
  try {
    return new URL(raw, baseUrl ?? document.baseURI).href
  } catch {
    return null
  }
}

/** @font-face 안 url(...)을 data URL로 바꾼다 — 못 받은 url은 그대로 둔다(글꼴만 대체 글꼴로 그려진다) */
async function inlineFontUrls(face: FontFaceLike): Promise<string> {
  const inlined = new Map<string, string>()
  for (const raw of fontUrls(face.cssText)) {
    const abs = absoluteUrl(raw, face.baseUrl)
    const data = abs ? await fetchAsDataUrl(abs) : null
    if (data) inlined.set(raw, data)
  }
  return replaceFontUrls(face.cssText, inlined)
}

/** 동시에 받는 글꼴 파일 수 — 한꺼번에 수백 건을 보내면 ERR_INSUFFICIENT_RESOURCES로 실패한다 */
const FONT_FETCH_CONCURRENCY = 6

/** 노드에 쓰인 글꼴만 넣은 @font-face CSS */
export async function embeddedFontCss(root: HTMLElement): Promise<string> {
  const faces = selectFontFaces(documentFontFaces(), usedTextProfile(root))
  const out: string[] = new Array(faces.length)
  let next = 0
  const worker = async () => {
    while (next < faces.length) {
      const i = next++
      out[i] = await inlineFontUrls(faces[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(FONT_FETCH_CONCURRENCY, faces.length) }, worker))
  return out.join('\n')
}
