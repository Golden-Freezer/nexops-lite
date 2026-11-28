/**
 * K 첫 화면 안 B '3박자'(결정 카드 c19, 하네스 J24 — 오너 11-07 승인 카드 원문: 여백 80·약속 한 줄·움직이는 정사각 대표·증거 띠·해결 한 줄, 다음 섹션이 보인다).
 * hookbeats 스위치 잡에만 근거 HOOK_BEATS_EVIDENCE를 세워(select-line lineEvidenceOf) 이 표지(needs.evidence)가 있는 첫 화면 템플릿을 연다. 정원(garden_diy)
 * 한 종부터다(인터뷰 I5-3). 꺼진 잡은 근거 잠금으로 후보가 0이라 선택·컷·렌더가 바이트까지 같다.
 * lint 예외 3건(보조 글 둘·가장 큰 사진 하한·여백)은 이 표지 템플릿에만 둔다(통합 11-10 00:0x·00:3x) — 안 B 원문을 확인 판(J32)에서 그대로 재기 위함이고,
 * 사진 하한은 오너 11-04 '제품 크게' 0.55의 예외다. 기하 조건만으로는 열지 않는다. 순수 상수
 */

/** 안 B 근거 이름 — 스펙에서 나오지 않고 스위치로만 선다(selection-facts evidenceOf에는 없다) */
export const HOOK_BEATS_EVIDENCE = 'hook_beats'

/** 안 B 표지 템플릿인가 — 근거 잠금 이름으로 가른다 */
export const isHookBeats = (t: { needs?: { evidence?: readonly string[] } }): boolean => t.needs?.evidence?.includes(HOOK_BEATS_EVIDENCE) ?? false

/** 예외 ① 첫 화면 글 — 큰 제목 하나일 때 보조 둘(증거·해결)까지, 첫 화면 글 전체 3줄·36자 이하(1~3초 판독 한도 안) */
export const HOOK_BEATS_TEXT = { subs: 2, lines: 3, chars: 36 } as const

/** 예외 ② 첫 화면 가장 큰 사진 하한 — 풀폭 1:1 대표(860×860)가 0.462다. 그 밖 첫 화면은 HOOK_PHOTO_SHARE_MIN 0.55 그대로 */
export const HOOK_BEATS_PHOTO_SHARE_MIN = 0.45

/** 예외 ③ 여백 — 안 B 원문 위 80·아래 40(높이 약 1561, 다음 섹션 약 299px 보임). 그 밖 값은 SPACING_RANGE 그대로 */
export const HOOK_BEATS_SPACING: Readonly<Partial<Record<'top' | 'bottom', number>>> = { top: 80, bottom: 40 }

/**
 * 안 B 칸 카피 안내 한 줄 — 칸 이름(proof·solve)만으로는 증거 띠·해결 한 줄의 뜻이 안 보여, 섹션 설명 뒤에 붙인다(section-values slotCopySections).
 * 새 사실·수치를 더하라는 말은 없다(사실 칸·규제 검사는 그대로). 안 B 표지 템플릿에만 붙어 꺼진 잡은 칸 카피 프롬프트가 바이트까지 같다
 */
export const HOOK_BEATS_COPY_NOTE =
  '  칸 안내: proof는 사진 아래 증거 띠의 한 줄이다 — 위 사실 하나를 짧게 쓰고, 수치·별점·인증이 사실 목록에 있으면 그것을 먼저 고른다. 사실 목록에 없는 값은 쓰지 않는다. solve는 고객의 고민이 이 상품으로 풀리는 장면 한 줄이고 새 사실을 더하지 않는다.'

/** 안 B 표지 템플릿의 칸 카피 안내 줄 — 표지가 없으면 null(카피 프롬프트가 지금 그대로다) */
export const hookBeatsCopyNote = (t: { needs?: { evidence?: readonly string[] } }): string | null => (isHookBeats(t) ? HOOK_BEATS_COPY_NOTE : null)
