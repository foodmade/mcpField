/**
 * 短时缓存：同一个键在 ttlMs 内共用一次查询（缓存的是 Promise，并发的相同请求只查一次）；查询失败的不缓存。
 * 过期后先返回旧结果、后台重新查询，查到后替换（失败时继续用旧的，下次请求再试），访问者不用等慢查询。
 * 超过 maxEntries 时淘汰最久没用到的（爬虫翻大量分页时，首页这类常用结果不会被挤掉）。发布层每天只重建一次，列表、分类计数这类慢查询缓存几分钟没有影响。
 */
export class TtlCache<T> {
  private readonly entries = new Map<string, { at: number; value: Promise<T>; refreshing?: boolean }>()

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string, load: () => Promise<T>): Promise<T> {
    const t = this.now()
    const hit = this.entries.get(key)
    if (hit && t - hit.at > this.ttlMs && !hit.refreshing) {
      hit.refreshing = true
      load().then(
        (fresh) => this.entries.get(key) === hit && this.set(key, { at: this.now(), value: Promise.resolve(fresh) }),
        () => (hit.refreshing = false),
      )
    }
    if (hit) {
      // 移到末尾，记为最近用到
      this.entries.delete(key)
      this.entries.set(key, hit)
      return hit.value
    }
    const value = load()
    this.set(key, { at: t, value })
    value.catch(() => {
      if (this.entries.get(key)?.value === value) this.entries.delete(key)
    })
    return value
  }

  private set(key: string, entry: { at: number; value: Promise<T> }): void {
    this.entries.delete(key)
    this.entries.set(key, entry)
    if (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value!)
  }
}
