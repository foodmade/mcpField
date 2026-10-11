import { zh } from './zh'
import { en } from './en'
import { ja } from './ja'
import type { Locale } from './locales'

export type Messages = typeof zh

export const messages: Record<Locale, Messages> = { zh, en, ja }
