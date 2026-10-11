import { createHash } from 'node:crypto'

/** 规范化原文：去首尾空白、合并连续空白。采集端和接口端必须用同一个函数，才能按指纹查到译文 */
export function normalizeSource(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** 原文指纹：规范化后的 SHA-256 */
export function sourceHash(text: string): string {
  return createHash('sha256').update(normalizeSource(text)).digest('hex')
}
