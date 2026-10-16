import { createHash } from 'node:crypto'

/** 规范化原文：去首尾空白、合并连续空白。采集端和接口端必须用同一个函数，才能按指纹查到译文 */
export function normalizeSource(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** 原文指纹：规范化后的 SHA-256 */
export function sourceHash(text: string): string {
  return createHash('sha256').update(normalizeSource(text)).digest('hex')
}

/**
 * 规范化多行原文（工具描述、参数说明）：保留换行和列表结构，只去掉行首尾空白、合并行内连续空白和多余空行。
 * 单行文本的结果与 normalizeSource 相同，和简介相同的原文共用译文
 */
export function normalizeBlock(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 多行原文的指纹：采集端和接口端都用它查译文 */
export function blockHash(text: string): string {
  return createHash('sha256').update(normalizeBlock(text)).digest('hex')
}
