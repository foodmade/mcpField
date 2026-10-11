import { CrawlerError, UnknownSourceError } from './errors.ts'
import type { SourceFactory } from './source.ts'

/** 数据源注册表：按 ID 查找工厂，运行器不直接依赖任何具体数据源 */
export class SourceRegistry {
  private readonly factories = new Map<string, SourceFactory>()

  register(factory: SourceFactory): this {
    const { id } = factory.meta
    if (this.factories.has(id)) throw new CrawlerError(`数据源 "${id}" 重复注册`)
    this.factories.set(id, factory)
    return this
  }

  get(id: string): SourceFactory {
    const factory = this.factories.get(id)
    if (!factory) throw new UnknownSourceError(id, [...this.factories.keys()])
    return factory
  }

  list(): SourceFactory[] {
    return [...this.factories.values()]
  }
}
