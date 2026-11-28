/**
 * 컷 목적 낱말(K A4 #10) — 글이 구조·소재·크기·동작·장소를 말하는지 본다. 디자인 컷(shot-diversity)과 K 컷(shot-refine)이 같은 낱말을 쓴다. 순수.
 */

export type ProofPurpose = 'underside' | 'texture' | 'scale'

// 목적 낱말 — 제목·설명·사양 글에서 찾는다(대소문자 무시). 크기는 사양에 크기가 있을 때만 목적이 된다
export const STRUCTURE_RE = /바닥|밑면|밑판|안쪽|내부|단면|입체|구조|이중|칸막이|수납|포켓|안감|받침|뼈대|심지|입구|뚜껑|프레임/
export const MATERIAL_RE =
  /소재|재질|원단|촉감|질감|가죽|실리콘|스테인리스|스텐|원목|도자기|유리|플라스틱|네오프렌|벨벳|패브릭|폴리에스터|메쉬|코팅|마감|광택|무광|돈모|모질|부드러|매끈|도톰|두툼|\b(?:ABS|PE|PP|EVA|TPU|TPE)\b/i
export const SIZE_RE = /\d+(?:\.\d+)?\s*(?:cm|mm|ml|인치)|크기|사이즈|넉넉|컴팩트|미니|대용량|한\s?손|손바닥|휴대/i
export const ACTION_RE =
  /당기|누르|눌러|돌리|돌려|열고|열어|닫아|닫히|닫고|끼우|끼워|붙이|붙여|걸어|걸면|접어|접으|펼치|밀어|넣고|넣어|빼고|씻어|빗어|문질|감아|조이|잠그|채워|조절|분리|조립/

// 장소·상황 낱말 — 제목이 이걸 말하면 그 장면을 그려야 한다(P04 '욕실에도 두세요'가 세트 정물로 나왔다). 사실 입력이 없어도 카피가 이미 한 말이다
export const PLACE_RE =
  /욕실|화장실|세면대|샤워|거실|침실|안방|주방|부엌|싱크대|식탁|현관|베란다|사무실|회사|학교|어린이집|교실|책상|차량|차 안|캠핑|야외|여행|출장|출근|외출|헬스장|운동|등산|수영|공간마다|어디서|어디든|어디에/

/** 사양 소재 낱말(괄호·기호로 끊은 2자 이상) — 카피가 사양 소재를 그대로 말하면 질감 목적이다 */
export function materialWords(material: string): string[] {
  return material.split(/[^가-힣A-Za-z]+/).filter((w) => w.length >= 2)
}

export function purposesIn(text: string, hasSize: boolean, materials: readonly string[]): Array<ProofPurpose | 'action'> {
  const out: Array<ProofPurpose | 'action'> = []
  if (STRUCTURE_RE.test(text)) out.push('underside')
  if (MATERIAL_RE.test(text) || materials.some((w) => text.includes(w))) out.push('texture')
  if (hasSize && SIZE_RE.test(text)) out.push('scale')
  if (ACTION_RE.test(text)) out.push('action')
  return out
}
