import { motion } from 'motion/react'
import { DiscordLogo, GithubLogo, Lifebuoy, PlugsConnected, TwitterLogo } from '@phosphor-icons/react'
import { useI18n } from '../i18n/context'
import { LanguageMenu } from './LanguageMenu'

export function Footer() {
  const { m } = useI18n()
  return (
    <footer className="border-t border-line">
      <div className="mx-auto max-w-[1248px] px-6 pb-8 pt-14">
        <div className="grid gap-10 md:grid-cols-[1fr_repeat(4,140px)] lg:grid-cols-[1fr_repeat(4,160px)]">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="grid size-[26px] place-items-center rounded-md bg-gradient-to-br from-accent to-blue text-accent-ink"><PlugsConnected size={16} weight="bold" /></span>
              <span className="text-[17px] font-semibold tracking-tight">MCP Field</span>
            </div>
            <p className="mt-3.5 text-sm text-text2">{m.footer.tagline}</p>
            <button className="mt-3.5 flex h-[34px] items-center gap-1.5 rounded-lg border border-line bg-white/[0.04] px-3 text-sm transition-colors hover:border-white/20">
              <Lifebuoy size={15} className="text-text2" />{m.footer.support}
            </button>
          </div>
          {m.footer.cols.map(([h, items]) => (
            <div key={h}>
              <div className="text-sm font-semibold">{h}</div>
              <ul className="mt-3 flex flex-col gap-3">
                {items.map((it) => (
                  <li key={it}>
                    <a href={it.includes('@') ? `mailto:${it}` : '#'} className="text-sm text-text2 transition-colors hover:text-ink">{it}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-12 flex items-center justify-between border-t border-line pt-5">
          <span className="text-xs text-text3">© 2026 MCP Field</span>
          <div className="flex items-center gap-5 text-text2">
            <LanguageMenu variant="text" />
            {[GithubLogo, TwitterLogo, DiscordLogo].map((Icon, i) => (
              <motion.a key={i} href="#" whileHover={{ y: -2, color: '#F3F4F6' }} aria-label={['GitHub', 'X', 'Discord'][i]}><Icon size={18} /></motion.a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  )
}
