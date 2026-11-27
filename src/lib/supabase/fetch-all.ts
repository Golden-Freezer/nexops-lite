/**
 * PostgREST의 max_rows(기본 1000) 제한을 우회하여 조건에 맞는 전체 행을
 * range 페이지네이션으로 모두 조회한다.
 *
 * Supabase 쿼리 빌더는 await/range 실행 후 재사용할 수 없으므로,
 * 매 페이지마다 동일한 필터/정렬이 적용된 새 쿼리를 생성하는 팩토리를 받는다.
 *
 * @param buildQuery 매 호출마다 동일 조건의 새 쿼리를 반환하는 팩토리
 * @param pageSize   페이지 크기 (기본 1000, PostgREST 기본 캡과 동일)
 */
/** 범위 초과 = 데이터 끝 신호 판별 (PostgREST 416 / PGRST103). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isRangeEnd(err: any): boolean {
  const code = String(err?.code ?? '')
  const msg = String(err?.message ?? '')
  return code === 'PGRST103' || code === '416' || /range not satisfiable/i.test(msg)
}

export async function fetchAllRows(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildQuery: () => any,
  pageSize = 1000,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ data: any[]; error: any }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all: any[] = []
  for (let from = 0; ; from += pageSize) {
    // 전체 행 수가 pageSize의 정확한 배수일 때, 다음 페이지 요청의 offset이
    // 전체 행 수와 같아져 PostgREST가 416(Range Not Satisfiable)을 반환한다.
    // 버전에 따라 error 객체로 오거나 예외로 던져질 수 있으므로 양쪽 모두 처리한다.
    // 이는 "더 이상 데이터 없음"을 의미하므로, 첫 페이지가 아니면 수집분으로 정상 종료한다.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let data: any[] | null = null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let error: any = null
    try {
      ;({ data, error } = await buildQuery().range(from, from + pageSize - 1))
    } catch (e) {
      // 범위 초과(416/PGRST103)만 "데이터 끝" — 그 외 예외를 삼키면 부분 합계가
      // 정상 결과처럼 반환된다 (audit §1-13)
      if (from > 0 && isRangeEnd(e)) break
      return { data: all, error: e }
    }
    if (error) {
      if (isRangeEnd(error)) break
      return { data: all, error }
    }
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < pageSize) break
  }
  return { data: all, error: null }
}
