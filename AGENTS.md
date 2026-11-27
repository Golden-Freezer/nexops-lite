# NEXOPS 라이트 — AI 작업 지침 (Codex·Claude 공통)

이 폴더는 쿠팡 로켓그로스 셀러 대표님 한 분이 쓰는 사업장 운영 장부(Next.js 15 + Supabase)다. 대표님은 개발자가 아니다. 쉬운 한국어로, 한 번에 한 단계씩, 다음에 누를 버튼 이름을 정확히 알려 준다.

## 대표님이 자주 시키는 일
| 대표님 말 | 할 일 |
|---|---|
| "오늘 장부 업데이트해 줘" | `npm run ledger` 실행. 크롬 창이 뜨면 대표님이 쿠팡에 로그인(처음 한 번, 2단계 인증 포함). 끝나면 출력의 '새로/고침/건너뜀' 숫자를 표로 요약하고 장부 주소의 대시보드를 새로고침하라고 안내 |
| (참고) | 판매·재고·광고비는 같은 날짜를 다시 올리면 그 날짜를 새로 덮어쓴다. 그래서 다시 올려도 결과가 "새로 N"으로 나오지만 숫자가 두 배가 되지는 않는다 |
| "샘플로 먼저 해 봐" | `npm run ledger -- --시험` (samples 폴더의 가짜 파일 3개만 올림) |
| "광고 보고서 올려 줘" / "주력상품 갱신" | 대표님이 광고센터 ▶ 광고 보고서 ▶ 매출 성장 광고 보고서에서 받은 `*_pa_total_campaign_*.xlsx`를 `장부받기/받은파일`에 두게 하고 `npm run ledger -- --올리기만 장부받기/받은파일` |
| "상세페이지 만들어 줘" / "대표이미지 만들어 줘" | `npm run dev` 실행 → http://localhost:3000/registration/detail-page (또는 /registration/thumbnail) 을 열게 안내. 만들기는 이 PC에서만 된다(Vercel 주소에서는 보기·고치기만) |
| "배포해 줘" | 아래 '처음 배포' 순서 |

## 처음 배포
`docs/배포.md`의 '2. AI가 하는 순서'를 그대로 따른다(2026-11-27 실제 시험 통과 순서). Supabase·Vercel 모두 CLI로 하고, 대표님은 브라우저 로그인·허용만 한다. 비밀번호·키 값은 화면에 출력하지 않고 `.env.local`·`장부받기/`(둘 다 .gitignore)에만 둔다.

## 지킬 것
- service_role key·업로드 키·비밀번호를 화면에 다시 출력하거나 git에 올리지 않는다. `.env.local`, `장부받기/`는 .gitignore에 있다.
- 쿠팡 로그인·2단계 인증은 대표님이 직접 한다. 비밀번호를 대신 입력하지 않는다.
- 쿠팡 화면에서는 장부받기 스크립트가 누르는 버튼(어제·자세히보기·전체 상품목록 엑셀 다운로드·엑셀 다운로드 요청·보고서 만들기·엑셀파일 다운로드)만 쓴다. 가격·재고·광고 설정을 바꾸는 버튼은 누르지 않는다.
- API 키 로그인을 쓰지 않는다. 상세페이지·이미지는 `codex` CLI(ChatGPT 구독 로그인)로만 만든다.
- 막히면 오류 문장을 그대로 보여 주고, 대표님이 할 일 한 가지만 말한다.

## 구조 (고칠 때 참고)
- 화면 `src/app/(dashboard)/*`, API `src/app/api/*`, 계산 `src/lib/*`, DB `supabase/migrations/*.sql`
- 로그인: Supabase Auth(`src/middleware.ts`, `src/lib/auth/clerk.ts` — 이름만 NEXOPS와 같고 Clerk는 안 씀)
- 파일 올리기: 웹 `/import`, AI용 `/api/import/file`(Bearer 업로드 키)
- 장부받기: `scripts/ledger-fetch/fetch.mjs`
- 상품등록 Codex 실행: `src/lib/local-codex/*`
