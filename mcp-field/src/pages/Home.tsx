import { Categories } from '../components/Categories'
import { FaqSection } from '../components/Faq'
import { Featured } from '../components/Featured'
import { Hero } from '../components/Hero'
import { Rankings } from '../components/Rankings'
import { Seo } from '../components/Seo'
import { Container } from '../components/ui'
import { useI18n } from '../i18n/context'
import { loadHome } from '../lib/api/loaders'
import { absoluteUrl, SITE } from '../lib/seo'
import type { Route } from './+types/Home'

export const loader = (args: Route.LoaderArgs) => loadHome(args)

export default function Home({ loaderData }: Route.ComponentProps) {
  const { m, locale } = useI18n()
  const { hero, featured, hot, skillRank, facets } = loaderData
  // 站点信息 + 首页 FAQ 的结构化数据
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', name: 'MCP Field', url: absoluteUrl(locale, '/'), inLanguage: locale === 'zh' ? 'zh-CN' : locale, description: m.meta.homeDescription },
      { '@type': 'Organization', name: 'MCP Field', url: SITE, logo: `${SITE}/favicon.svg` },
      { '@type': 'FAQPage', mainEntity: m.faq.items.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
    ],
  }
  return (
    <>
      <Seo title={m.meta.home} description={m.meta.homeDescription} path="/" jsonLd={jsonLd} />
      <Container className="pt-6">
        <Hero slides={hero} />
      </Container>
      <Categories facets={facets} />
      <Rankings hot={hot} skills={skillRank} />
      <Featured data={featured} />
      <FaqSection />
    </>
  )
}
