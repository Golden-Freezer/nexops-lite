import { gunzipSync } from 'node:zlib'

/** Vercel의 요청 본문 한도보다 여유 있게 낮춘 압축 전송 상한. */
export const AUTO_IMPORT_MAX_COMPRESSED_BYTES = 4 * 1024 * 1024
/** 기존 14 MiB base64 파일과 JSON 봉투를 수용하는 해제 후 상한. */
export const AUTO_IMPORT_MAX_DECOMPRESSED_BYTES = 16 * 1024 * 1024

export type AutoImportBodyErrorCode =
  | 'UNSUPPORTED_ENCODING'
  | 'UNSUPPORTED_CONTENT_TYPE'
  | 'INVALID_BODY'
  | 'INVALID_GZIP'
  | 'INVALID_JSON'
  | 'COMPRESSED_BODY_TOO_LARGE'
  | 'DECOMPRESSED_BODY_TOO_LARGE'

/** 라우트가 원문을 노출하지 않고 400/413으로 변환할 수 있는 안전한 오류. */
export class AutoImportBodyError extends Error {
  readonly status: 400 | 413
  readonly code: AutoImportBodyErrorCode

  constructor(
    status: 400 | 413,
    code: AutoImportBodyErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'AutoImportBodyError'
    this.status = status
    this.code = code
  }
}

function getMediaType(contentType: string | null): string {
  return contentType?.split(';', 1)[0].trim().toLowerCase() ?? ''
}

function getDeclaredLength(request: Request): number | null {
  const value = request.headers.get('content-length')?.trim()
  if (!value || !/^\d+$/.test(value)) return null

  const length = Number(value)
  return Number.isSafeInteger(length) ? length : null
}

async function readBytes(
  request: Request,
  limit: number,
  tooLargeCode: Extract<
    AutoImportBodyErrorCode,
    'COMPRESSED_BODY_TOO_LARGE' | 'DECOMPRESSED_BODY_TOO_LARGE'
  >,
  tooLargeMessage: string
): Promise<Buffer> {
  const declaredLength = getDeclaredLength(request)
  if (declaredLength != null && declaredLength > limit) {
    throw new AutoImportBodyError(413, tooLargeCode, tooLargeMessage)
  }

  if (!request.body) return Buffer.alloc(0)

  const reader = request.body.getReader()
  const chunks: Buffer[] = []
  let totalBytes = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue

      const nextTotal = totalBytes + value.byteLength
      if (nextTotal > limit) {
        await reader.cancel().catch(() => undefined)
        throw new AutoImportBodyError(413, tooLargeCode, tooLargeMessage)
      }

      chunks.push(Buffer.from(value))
      totalBytes = nextTotal
    }
  } catch (error) {
    if (error instanceof AutoImportBodyError) throw error
    throw new AutoImportBodyError(
      400,
      'INVALID_BODY',
      '요청 본문을 읽을 수 없습니다.'
    )
  } finally {
    reader.releaseLock()
  }

  return Buffer.concat(chunks, totalBytes)
}

function isMaxOutputLengthError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ERR_BUFFER_TOO_LARGE'
  )
}

function parseJson<T>(bytes: Uint8Array): T {
  try {
    const json = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return JSON.parse(json) as T
  } catch {
    throw new AutoImportBodyError(
      400,
      'INVALID_JSON',
      '요청 본문 JSON 형식이 올바르지 않습니다.'
    )
  }
}

/**
 * 자동 임포트가 지원하는 두 전송 형태를 단일 경로로 검증·해제한다.
 * - application/json: 평문 JSON
 * - application/octet-stream + X-Nexops-Encoding: gzip: gzip JSON
 */
export async function decodeAutoImportBody<T = unknown>(
  request: Request
): Promise<T> {
  const contentType = getMediaType(request.headers.get('content-type'))
  const encodingHeader = request.headers.get('x-nexops-encoding')

  if (encodingHeader == null) {
    if (contentType !== 'application/json') {
      throw new AutoImportBodyError(
        400,
        'UNSUPPORTED_CONTENT_TYPE',
        '지원하지 않는 Content-Type입니다.'
      )
    }

    const jsonBytes = await readBytes(
      request,
      AUTO_IMPORT_MAX_DECOMPRESSED_BYTES,
      'DECOMPRESSED_BODY_TOO_LARGE',
      '요청 본문이 너무 큽니다.'
    )
    return parseJson<T>(jsonBytes)
  }

  if (encodingHeader.trim().toLowerCase() !== 'gzip') {
    throw new AutoImportBodyError(
      400,
      'UNSUPPORTED_ENCODING',
      '지원하지 않는 요청 본문 인코딩입니다.'
    )
  }
  if (contentType !== 'application/octet-stream') {
    throw new AutoImportBodyError(
      400,
      'UNSUPPORTED_CONTENT_TYPE',
      'gzip 요청은 application/octet-stream Content-Type이어야 합니다.'
    )
  }

  const compressedBytes = await readBytes(
    request,
    AUTO_IMPORT_MAX_COMPRESSED_BYTES,
    'COMPRESSED_BODY_TOO_LARGE',
    '압축 요청 본문이 너무 큽니다.'
  )

  let jsonBytes: Buffer
  try {
    jsonBytes = gunzipSync(compressedBytes, {
      maxOutputLength: AUTO_IMPORT_MAX_DECOMPRESSED_BYTES,
    })
  } catch (error) {
    if (isMaxOutputLengthError(error)) {
      throw new AutoImportBodyError(
        413,
        'DECOMPRESSED_BODY_TOO_LARGE',
        '압축 해제한 요청 본문이 너무 큽니다.'
      )
    }
    throw new AutoImportBodyError(
      400,
      'INVALID_GZIP',
      'gzip 요청 본문이 올바르지 않습니다.'
    )
  }

  return parseJson<T>(jsonBytes)
}
