import { load, type CheerioAPI } from 'cheerio'

export type Html = CheerioAPI

export function loadHtml(body: string): Html {
  return load(body)
}
