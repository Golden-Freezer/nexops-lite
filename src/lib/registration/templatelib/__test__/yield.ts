/**
 * 시험 전용 — 긴 반복 시험이 이벤트 루프에 양보한다.
 * 이미 resolve 된 promise 만 await 하는 긴 반복은 마이크로태스크만 돌아 작업자가 메인의 RPC 응답(IPC)을 읽지 못하고,
 * vitest 작업자 RPC 60초 타이머가 먼저 터져 'Timeout calling "onTaskUpdate"' 로 exit 1 이 된다(AX-PL-38).
 * setImmediate 는 check 단계에서 깨어나므로 그 사이 poll 단계가 응답을 읽는다. 시험 내용·횟수는 바꾸지 않는다.
 */
export const yieldToEventLoop = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve))
