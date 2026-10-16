import { BaseSourceFactory } from '../../core/base-source.ts'
import type { Discoverer, Fetcher, Mapper, Parser, SourceContext, SourceMeta } from '../../core/source.ts'
import type { EntityKind } from '../../core/types.ts'
import { SkillsShActivityStore } from './activity.ts'
import { SkillsShDiscoverer } from './discoverer.ts'
import { SkillsShFetcher } from './fetcher.ts'
import { SkillsShMapper } from './mapper.ts'
import { SkillsShParser } from './parser.ts'
import { VercelOidcToken, vercelPull } from './token.ts'
import { SKILLS_SH_ORIGIN } from './urls.ts'

/**
 * skills.sh：走官方 API（Vercel OIDC 认证），排行榜发现（按仓库推送时间决定已收录的要不要重新抓）+ 详情与安全审计合并抓取。只有 Skill 一种类型。
 * robots.txt 的 Disallow: /api/ 针对的是网页爬虫；文档化、需认证的 API 是网站提供的正式数据接口，所以这里不检查 robots。
 */
export class SkillsShFactory extends BaseSourceFactory {
  readonly meta: SourceMeta = {
    id: 'skills-sh',
    name: 'skills.sh',
    homepage: SKILLS_SH_ORIGIN,
    kinds: ['skill'],
    // 认证后每分钟 600 次，按每秒 9 次留出余量；每个 skill 要请求详情和审计两次，单次实测约 1.2 秒，并发要够高才能用满额度
    politeness: { requestsPerSecond: 9, concurrency: 12, respectRobots: false, maxRetries: 4, timeoutMs: 60_000 },
  }

  override createFetcher(ctx: SourceContext): Fetcher {
    const token = new VercelOidcToken(ctx.config.skillsShVercelDir, vercelPull(ctx.config.vercelToken))
    const http = super.createFetcher(ctx)
    return new SkillsShFetcher({
      fetch: async (request) => http.fetch({ ...request, headers: { accept: 'application/json', ...request.headers, authorization: `Bearer ${await token.get()}` } }),
    })
  }

  createDiscoverer(ctx: SourceContext, fetcher: Fetcher): Discoverer {
    if (!(fetcher instanceof SkillsShFetcher)) throw new Error('skills-sh 的发现器需要 SkillsShFetcher')
    // 没有数据库（输出到文件调试）时没有仓库推送时间，已收录的判断交给运行器，安装量也不记录
    return new SkillsShDiscoverer(fetcher, this.meta.id, ctx.db ? new SkillsShActivityStore(ctx.db) : undefined)
  }

  createParser(kind: EntityKind): Parser {
    this.assertKind(kind)
    return new SkillsShParser()
  }

  createMapper(kind: EntityKind): Mapper {
    this.assertKind(kind)
    return new SkillsShMapper()
  }
}
