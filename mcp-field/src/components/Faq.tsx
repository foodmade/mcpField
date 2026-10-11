import * as Accordion from '@radix-ui/react-accordion'
import { Plus } from '@phosphor-icons/react'
import { RevealGroup, RevealItem } from '../fx/Reveal'
import { useI18n } from '../i18n/context'
import { Container, LinkArrow } from './ui'

export function FaqList() {
  const { m } = useI18n()
  const items = m.faq.items
  return (
    <Accordion.Root type="single" collapsible defaultValue="0">
      {items.map(([q, a], i) => (
        <Accordion.Item key={i} value={String(i)} className="group border-t border-line last:border-b">
          <Accordion.Header>
            <Accordion.Trigger className="flex w-full items-center justify-between gap-6 py-5 text-left text-[17px] font-medium transition-colors hover:text-white data-[state=open]:font-semibold">
              {q}
              <span className="grid size-7 shrink-0 place-items-center rounded-full border border-white/10 text-text2 transition-all duration-300 group-data-[state=open]:rotate-45 group-data-[state=open]:border-accent/40 group-data-[state=open]:text-accent">
                <Plus size={14} />
              </span>
            </Accordion.Trigger>
          </Accordion.Header>
          <Accordion.Content className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
            <p className="max-w-[640px] pb-5 pr-12 text-[15px] leading-[1.75] text-text2">{a}</p>
          </Accordion.Content>
        </Accordion.Item>
      ))}
    </Accordion.Root>
  )
}

export function FaqSection() {
  const { m } = useI18n()
  return (
    <Container className="py-24">
      <div className="grid gap-12 lg:grid-cols-[360px_1fr] lg:gap-20">
        <RevealGroup className="lg:sticky lg:top-32 lg:self-start">
          <RevealItem><h2 className="text-[32px] font-bold leading-tight tracking-tight">{m.faq.title}</h2></RevealItem>
          <RevealItem><p className="mt-4 text-[15px] leading-[1.7] text-text2">{m.faq.sub}</p></RevealItem>
          <RevealItem><LinkArrow className="mt-6 font-medium text-ink">{m.faq.guide}</LinkArrow></RevealItem>
        </RevealGroup>
        <RevealGroup><RevealItem><FaqList /></RevealItem></RevealGroup>
      </div>
    </Container>
  )
}
