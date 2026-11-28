/**
 * 사람 컷 장면 안전(J60) — 새 배치(힉스필드 MS 2k) 컷 지시만 다룬다. 지금 배치(2.6 high 등) 지시는 바이트 그대로다.
 * 근거: J59 켬 잡 c5555eff(P03)에서 사람이 샤워 안에 있는 K 컷 3장(샤워실 옆모습·물줄기 아래 뒷모습·샤워 마치며 전신)이 모두 nsfw로
 * 끝나 빈 칸이 됐다. 같은 상품의 거품 낸 머리를 욕실 카운터에서 문지르는 컷, 허리 위로 물줄기에 브러시만 헹구는 컷은 통과했다.
 *   ① 예방(withBathSceneSafety) — 몸이 나오는 Person 줄이 있고 장면 글(컷 지시 블록·연출 감독 줄)이 샤워·목욕을 말하면 컷 지시 블록의
 *      Camera 줄을 '욕실 세면대 앞 가슴 위' 구도로, Person 줄의 몸 범위를 '가슴 위, 다른 컷과 같은 옷'으로 바꾼다(줄을 더하지 않고 바꿔
 *      MS 5,000자 맞추기가 다른 블록을 더 덜지 않게). 긍정 서술로만 쓰고 금지 낱말은 나열하지 않는다(필터를 자극하지 않게).
 *      샤워·목욕 장면이 없거나 손만·사람 없는 컷은 바이트 그대로다.
 *   ② nsfw 재시도(nsfwRetryPrompt) — nsfw로 끝난 첫 시도는 다음 run의 재시도 1번(섹션당 1회, retryPending)에서 장면을 욕실 밖·긴소매
 *      손 구도·상품 중심으로 바꿔 부른다. 바꾼 줄은 컷 지시 블록의 Person·Camera·Stage와 연출 감독 지시(빛 규칙은 남기고 세트는 뺀다)다.
 *      바꿀 줄이 없는 지시(K 컷 지시 없는 컷)는 안전 장면 블록을 끝에 붙인다.
 * 두 갈래 모두 MS 5,000자 맞추기(fitMsPrompt) 앞에 한다 — 바꾼 줄은 덜지 않는 K 컷 지시 블록·감독 줄에 있다.
 * J68(J61 컷 확인 decide 43): 욕실 상품 고민 컷은 컷 지시에 Person 줄이 없고 샤워가 바탕 블록의 섹션 글(Context 줄 '샤워할 때 머리 감고도')에만
 * 있어 ①이 붙지 않았다 — 끔 2장은 수건만 두른 맨어깨로 통과, problemobject 켬 2장은 nsfw. 그래서 장면 글에 Context 줄(카피 질문, 여러 줄)을
 * 더하고, 사람 줄도 상품 참조(Refs) 줄도 없는 컷(상품 없는 고민 컷 — 사람이 나올 수 있다)은 Camera 줄 하나를 '세면대 앞 가슴 위·긴소매 윗옷'
 * 구도로 바꾼다(줄 추가 없음, 긍정 서술). 손만·사람 없는 컷·상품 컷(Refs 줄)·샤워 없는 지시는 그대로다.
 */

/** 장면 글이 샤워·목욕 안을 말하는가 — 'bathroom'(욕실 카운터·선반 세트)은 장면이 아니라 통과 근거라 세지 않는다 */
const BATH_WORDS = /\bshower(?:s|ing|ed)?\b|\bbath(?:s|tub|tubs|ing)?\b|\bbathe[sd]?\b|샤워|목욕|욕조|반신욕|입욕/i

const SHOT_BLOCK_HEAD = '[Shot direction]'
const DIRECTOR_HEAD = 'Art direction:'
/** 몸이 나오는 Person 줄 — personLine의 몸 범위 갈래만 'In this cut: 몸 범위; 동작; 얼굴.'을 쓴다(손만·사람 없음은 쓰지 않는다) */
const BODY_PERSON = /^(Person: .*\bIn this cut: )([^;]*)(;.*)$/

/** ① 바꾸는 Camera 줄 — 자리·거리를 정하고, 컷 지시 블록 아래 연출 감독 줄도 이 자리를 따르게 이름을 댄다 */
export const BATH_SAFE_CAMERA =
  'Camera: medium close-up at eye level, at a bright, tidy bathroom vanity — this place and distance win over the Stage and Art direction lines.'
/** ① Person 줄의 몸 범위 */
export const BATH_SAFE_FRAMING = 'from the chest up, dressed as in the other cuts'
/** ① 사람 줄 없는 상품 없는 컷(J68)의 Camera 줄 — 사람이 나오면 몸 범위·옷까지 이 줄이 정한다 */
export const BATH_SAFE_CAMERA_OPEN =
  'Camera: medium close-up at eye level, at a bright, tidy bathroom vanity; anyone shown is seen from the chest up in a soft long-sleeved top — this place and distance win over the Stage and Art direction lines.'

/** ② 바꾸는 줄들 */
export const NSFW_RETRY_PERSON =
  'Person: only the hands and forearms of the same one person as the other cuts of this page, in soft long sleeves — no face or head in the frame; calmly holding the product.'
export const NSFW_RETRY_CAMERA = 'Camera: close-up at eye level — the hands and the product fill the middle of the frame.'
export const NSFW_RETRY_STAGE =
  "Stage: a bright, tidy dressing table at home by a window, with at most two small props. Keep the page's light direction and color temperature."
export const NSFW_RETRY_DIRECTION =
  'Hands in soft long sleeves holding the product over a tidy dressing table, the product centered, large and sharp, calm everyday-care mood.'
/** ② 바꿀 줄이 없는 지시(K 컷 지시 없는 컷)의 끝 블록 */
export const NSFW_RETRY_BLOCK =
  'Scene for this cut (wins over every line above about the place and the people shown): only hands in soft long sleeves holding the product at a ' +
  'bright, tidy dressing table at home by a window; the product centered, large and sharp.'

const isShotBlock = (block: string) => block.startsWith(SHOT_BLOCK_HEAD)

/** 컷 지시 블록 줄만 바꾼다 — 다른 블록은 그대로 */
function mapShotLines(prompt: string, fn: (line: string) => string): string {
  return prompt
    .split('\n\n')
    .map((block) => (isShotBlock(block) ? block.split('\n').map(fn).join('\n') : block))
    .join('\n\n')
}

/** 섹션 글 줄(J68) — 바탕 블록의 'Context: ' 줄과 이어지는 카피 줄(다음 'Xxx:' 머리 줄·'- ' 목록·빈 줄 앞까지). 카테고리 고정 장면 줄은 보지 않는다 */
function contextLinesOf(prompt: string): string[] {
  const out: string[] = []
  let open = false
  for (const line of prompt.split('\n')) {
    if (line.startsWith('Context: ')) open = true
    else if (open && (line === '' || line.startsWith('- ') || /^[A-Z][\w /-]*:/.test(line))) open = false
    if (open) out.push(line)
  }
  return out
}

/** 장면 글 — 컷 지시 블록(목적·구도·사람·무대·섹션 글), 연출 감독 줄, 바탕 블록의 섹션 글(Context, J68). 바탕 템플릿·카테고리 고정 글은 보지 않는다 */
function sceneTextOf(prompt: string): string {
  const shot = prompt.split('\n\n').filter(isShotBlock)
  const director = prompt.split('\n').filter((line) => line.startsWith(DIRECTOR_HEAD))
  return [...shot, ...director, ...contextLinesOf(prompt)].join('\n')
}

/** 컷 지시 블록의 사람 갈래 — body: 몸 나오는 Person 줄, open: Person 줄도 상품 참조(Refs) 줄도 없음(상품 없는 고민 컷, J68), 그 밖은 null */
function bathPersonKindOf(prompt: string): 'body' | 'open' | null {
  const lines = prompt.split('\n\n').filter(isShotBlock).join('\n').split('\n')
  if (!lines.some((line) => line.startsWith('Camera: '))) return null
  if (lines.some((line) => BODY_PERSON.test(line))) return 'body'
  if (lines.some((line) => line.startsWith('Person: ') || line.startsWith('Refs: '))) return null
  return 'open'
}

/** 사람이 나오는(나올 수 있는) 컷의 샤워·목욕 장면인가 */
export function isBathPersonScene(prompt: string): boolean {
  return bathPersonKindOf(prompt) !== null && BATH_WORDS.test(sceneTextOf(prompt))
}

/**
 * ① 예방 — 샤워·목욕 장면의 몸 나오는 사람 컷이면 Camera 줄·Person 몸 범위를, 사람 줄 없는 상품 없는 컷(J68)이면 Camera 줄을 바꾼 지시.
 * 해당 없으면 null(지시 그대로)
 */
export function withBathSceneSafety(prompt: string): string | null {
  if (!isBathPersonScene(prompt)) return null
  const camera = bathPersonKindOf(prompt) === 'open' ? BATH_SAFE_CAMERA_OPEN : BATH_SAFE_CAMERA
  const out = mapShotLines(prompt, (line) => {
    if (line.startsWith('Camera: ')) return camera
    const person = BODY_PERSON.exec(line)
    return person ? `${person[1]}${BATH_SAFE_FRAMING}${person[3]}` : line
  })
  return out === prompt ? null : out
}

/** 연출 감독 줄의 지시 부분만 바꾼다 — 'Light: …'(빛 정본, 결정 카드 c15)는 남기고 'Set: …'(세트 장면)는 뺀다 */
function safeDirectorLine(line: string): string {
  const light = line.indexOf(' Light: ')
  if (light < 0) return `${DIRECTOR_HEAD} ${NSFW_RETRY_DIRECTION}`
  const tail = line.slice(light + 1)
  const set = tail.indexOf(' Set: ')
  return `${DIRECTOR_HEAD} ${NSFW_RETRY_DIRECTION} ${set < 0 ? tail : tail.slice(0, set)}`
}

/** 컷 지시에 붙일 장면 안전 — nsfw 재시도면 ②, 아니면 ①(해당 없으면 null = 지시 그대로) */
export function sceneSafetyOf(prompt: string, nsfwRetry: boolean): { prompt: string; kind: 'bath' | 'nsfw-retry' } | null {
  if (nsfwRetry) return { prompt: nsfwRetryPrompt(prompt), kind: 'nsfw-retry' }
  const safe = withBathSceneSafety(prompt)
  return safe ? { prompt: safe, kind: 'bath' } : null
}

/** ② nsfw 재시도 지시 — 사람·구도·무대·감독 지시를 욕실 밖 손 구도로 바꾼다. 사람 없는 컷(Person: no person)의 Person 줄은 그대로 둔다 */
export function nsfwRetryPrompt(prompt: string): string {
  let replaced = false
  const swap = (next: string) => {
    replaced = true
    return next
  }
  const shot = mapShotLines(prompt, (line) => {
    if (line.startsWith('Person: ') && !line.startsWith('Person: no person')) return swap(NSFW_RETRY_PERSON)
    if (line.startsWith('Camera: ')) return swap(NSFW_RETRY_CAMERA)
    if (line.startsWith('Stage: ')) return swap(NSFW_RETRY_STAGE)
    return line
  })
  const out = shot
    .split('\n')
    .map((line) => (line.startsWith(DIRECTOR_HEAD) ? swap(safeDirectorLine(line)) : line))
    .join('\n')
  return replaced ? out : `${out}\n\n${NSFW_RETRY_BLOCK}`
}
