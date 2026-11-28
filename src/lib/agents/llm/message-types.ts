/** Anthropic SDK 없이 기존 에이전트 메시지 모양을 유지하는 최소 공통 타입. */

export interface TextBlockParam {
  type: 'text'
  text: string
}

export interface Base64Source {
  type: 'base64'
  media_type: string
  data: string
}

export interface ImageBlockParam {
  type: 'image'
  source: Base64Source
}

export interface DocumentBlockParam {
  type: 'document'
  source: Base64Source
}

export type ContentBlockParam = TextBlockParam | ImageBlockParam | DocumentBlockParam

export interface MessageParam {
  role: 'user' | 'assistant'
  content: string | ContentBlockParam[]
}
