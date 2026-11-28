/**
 * Wing 상세설명 'HTML 작성'(에디터의 HTML 코드 입력) 칸에 붙여 넣을 본문 — 굽기·저장으로 올린 전체 이미지(780px) 공개 주소를
 * 순서대로 img 로 잇는다(AX-CT-30). 바깥 div 의 font-size·line-height 0 과 img display:block 으로 조각 사이 틈을 없앤다.
 *
 * 실측(2026-11-16, AX-CT-30): 쿠팡은 이 본문을 받아들이고 style·alt 를 남기며, 이미지를 쿠팡 저장소로 옮겨 담는다(JPG 는 바이트 그대로).
 * 다만 이번 실측에서는 움직이는 WebP 가 쿠팡 저장 때 정지 PNG 로 바뀌었다 — 투명도를 뺀 WebP 도 같았다.
 * 같은 파일(투명도를 뺀 WebP)을 상세설명 '이미지 업로드' 방식으로 올리면 쿠팡에서 webp 로 반영되어 움직였다(오너 확인, 반영까지 시간이 걸림).
 */

export const WING_IMG_STYLE = 'display:block;width:100%;max-width:780px;margin:0 auto;border:0'
export const WING_WRAP_STYLE = 'text-align:center;font-size:0;line-height:0'

/** 이번 실측 범위만 말하는 안내(움직이는 칸이 섞인 굽기 결과에 보인다) */
export const WING_HTML_MOTION_WARNING =
  '이번 실측(11-16)에서는 HTML 로 넣은 움직이는 WebP 가 쿠팡 저장 때 정지 그림(PNG)이 됐고, \'이미지 업로드\' 방식으로 올린 움직이는 WebP 는 움직였습니다(반영까지 시간이 걸림). 움직임이 필요하면 상세설명 등록 방식을 \'이미지 업로드\'로 하고 전체 조각 파일을 순서대로 올리세요.'

/** 복사·내려받기 안내 글 — 어느 저장 결과(주소 목록)에 대한 글인지 함께 든다 */
export interface WingHtmlNote {
  forUrls: readonly string[]
  text: string
}

/**
 * 지금 결과에 보일 안내 글 — 글을 만든 저장 결과와 지금 결과가 같은 목록(같은 참조)일 때만.
 * 다시 굽기로 run 이 바뀌면 옛 글('복사했습니다')을 숨겨, 옛 run 주소가 든 클립보드를 새 결과로 착각하지 않게 한다(#1320 검수 S1).
 */
export function visibleWingHtmlNote(note: WingHtmlNote | null, fullUrls: readonly string[] | null): string | null {
  return note && fullUrls && note.forUrls === fullUrls ? note.text : null
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * 공개 주소 목록 → Wing 용 HTML. alt 는 '<상품명> 상세 이미지 N'(상품명이 비면 '상세 이미지 N').
 * http(s) 주소가 아니면 넣지 않고 오류를 던진다 — 빈 칸이나 잘못된 주소가 쿠팡에 깨진 그림으로 남지 않게.
 */
export function buildWingDetailHtml(urls: readonly string[], productName?: string | null): string {
  if (urls.length === 0) throw new Error('붙여 넣을 이미지 주소가 없습니다.')
  const bad = urls.find((u) => !/^https?:\/\/\S+$/.test(u))
  if (bad !== undefined) throw new Error(`이미지 주소가 올바르지 않습니다: ${bad || '(빈 값)'}`)
  const name = (productName ?? '').trim()
  const altBase = name ? `${name} 상세 이미지` : '상세 이미지'
  const imgs = urls.map(
    (u, i) => `<img src="${escapeAttr(u)}" alt="${escapeAttr(`${altBase} ${i + 1}`)}" style="${WING_IMG_STYLE}">`,
  )
  return `<div style="${WING_WRAP_STYLE}">\n${imgs.join('\n')}\n</div>\n`
}
