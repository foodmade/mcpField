import { describe, expect, it } from 'vitest'
import { loadHtml } from '../src/extract/html.ts'
import { extractTanStackMatches, findLoaderValue } from '../src/extract/tanstack.ts'

const page = (script: string) => `<html><body><script class="$tsr" id="$tsr-stream-barrier">${script}</script></body></html>`

// 结构与 TanStack Start 输出一致的合成数据
const SAMPLE = page(
  '(self.$R=self.$R||{})["tsr"]=[];self.$_TSR={h(){},e(){},c(){},p(e){this.buffer.push(e)},buffer:[]};' +
    '$_TSR.router=($R=>$R[0]={matches:$R[1]=[$R[2]={i:"__root__",s:"success",l:$R[3]={gaId:"x"}},' +
    '$R[4]={i:" servers $name demo",s:"success",l:$R[5]={server:$R[6]={slug:"demo",featured:!1,verified:!0,' +
    'createdAt:$R[7]=new Date("2026-01-02T03:04:05.000Z"),rating:void 0,tags:"[\\"a\\"]"},categoryName:"Search"}}]})($R["tsr"]);' +
    '$_TSR.e();document.currentScript.remove()',
)

describe('extractTanStackMatches', () => {
  it('在沙箱里还原路由加载数据', async () => {
    const matches = await extractTanStackMatches(loadHtml(SAMPLE))
    expect(matches).toHaveLength(2)
    expect(findLoaderValue(matches, 'server')).toEqual({
      slug: 'demo',
      featured: false,
      verified: true,
      createdAt: '2026-01-02T03:04:05.000Z',
      tags: '["a"]',
    })
    expect(findLoaderValue(matches, 'categoryName')).toBe('Search')
  })

  it('没有内嵌数据时返回空数组', async () => {
    expect(await extractTanStackMatches(loadHtml('<html></html>'))).toEqual([])
  })

  it('死循环会被超时中断，不会卡住进程', async () => {
    await expect(extractTanStackMatches(loadHtml(page('while(true){}')))).rejects.toThrow(/interrupted/)
  })

  it('沙箱里没有 Node 能力', async () => {
    await expect(extractTanStackMatches(loadHtml(page('require("fs")')))).rejects.toThrow()
  })
})
