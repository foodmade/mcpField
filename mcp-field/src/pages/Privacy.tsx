import { Fragment } from 'react'
import { Container } from '../components/ui'
import { Seo } from '../components/Seo'
import { useI18n } from '../i18n/context'
import type { Locale } from '../i18n/locales'

/*
 * 隐私政策。正文按语言写在本文件里（法律文本较长，不放进界面文案）。
 * 内容要和网站的实际行为一致：没有统计和广告追踪；偏好和收藏只存在浏览器里；
 * 账号由 Supabase Auth 处理（GitHub、Google、邮箱验证码），项目位于印度孟买区域。
 * 修改正文时同步更新三种语言和生效日期。
 */

const CONTACT = 'privacy@mcpfield.com'

/** 段落是字符串，列表是字符串数组 */
type Block = string | string[]
type Section = { id: string; title: string; blocks: Block[] }
type Doc = { title: string; description: string; effective: string; intro: string; toc: string; sections: Section[] }

const DOCS: Record<Locale, Doc> = {
  zh: {
    title: '隐私政策',
    description: 'MCP Field 如何收集、使用和保护你的信息：浏览网站、使用 GitHub、Google 或邮箱验证码登录时会处理哪些信息，以及你可以怎样管理这些信息。',
    effective: '生效日期：2026 年 10 月 11 日',
    intro: 'MCP Field（mcpfield.com，以下称“我们”）是一个 MCP 服务与开发工具的导航网站。本政策说明你浏览网站和使用账号功能时，我们会处理哪些信息、为什么处理、交给谁处理，以及你可以怎样管理这些信息。',
    toc: '目录',
    sections: [
      {
        id: 'browsing',
        title: '浏览网站时',
        blocks: [
          '浏览网站不需要注册或登录。我们不使用第三方统计或广告追踪工具，也不出售任何信息。',
          '为了保障安全和排查故障，Cloudflare（我们使用的 CDN 和安全服务）与我们的服务器会自动记录访问日志，包括 IP 地址、浏览器类型、访问的网址和时间。这些日志只用于防范攻击和定位问题，在排查所需的期限过后删除。',
        ],
      },
      {
        id: 'browser-storage',
        title: '保存在你浏览器里的数据',
        blocks: [
          '下面这些设置和记录只保存在你自己的浏览器里（localStorage / sessionStorage），不会发送给我们，清除浏览器数据即可删除：',
          ['界面语言、明暗主题，以及是否关闭过语言提示', '你收藏的项目', '为加快页面加载而临时缓存的工具列表', '登录后的会话凭据，用于保持登录状态，退出登录时清除'],
          'Cloudflare 可能会设置防范恶意流量所必需的 Cookie。我们自己不使用广告或追踪类 Cookie。',
        ],
      },
      {
        id: 'account',
        title: '登录账号时',
        blocks: [
          '登录是可选的，用于收藏、评论、提交项目等需要识别身份的功能。你可以使用下面任一方式，第一次登录时会自动创建账号：',
          [
            'GitHub：我们获得你的 GitHub 用户 ID、用户名、显示名称、头像和邮箱地址。我们不会访问你的代码仓库，也不会以你的身份执行任何操作。',
            'Google：我们获得你的 Google 账号 ID、姓名、头像和邮箱地址（授权范围仅限 openid、email、profile）。我们不会访问你的 Gmail、通讯录、云端硬盘或其他 Google 数据。',
            '邮箱验证码：我们获得你填写的邮箱地址，并向它发送一次性验证码。验证码 10 分钟内有效，用过即失效。',
          ],
          '我们不会收到你在 GitHub 或 Google 的密码。同一个邮箱用不同方式登录，会进入同一个账号。',
          '账号还会记录创建时间、最近登录时间，以及登录时的 IP 地址和浏览器信息，用于保护账号安全，例如发现异常登录。',
        ],
      },
      {
        id: 'use',
        title: '我们如何使用这些信息',
        blocks: [
          ['创建和维护你的账号，让你保持登录', '在网站上显示你的名称和头像，例如导航栏，以及你公开发布的评论旁边', '发送登录验证码和与账号安全有关的必要通知', '防范滥用、垃圾信息和攻击', '回复你的咨询和请求'],
          '我们不会把你的信息用于广告，也不会出售或出租给任何人。我们对通过 Google API 获得的信息的使用和传输，遵守 Google API 服务用户数据政策（Google API Services User Data Policy），包括其中的“有限使用”要求。',
        ],
      },
      {
        id: 'sharing',
        title: '服务提供商与信息共享',
        blocks: [
          '我们只把信息交给帮助我们运营网站的服务提供商，并且只提供完成服务所需的部分：',
          ['Supabase：负责账号登录和账号数据存储，服务器位于印度孟买，因此你的账号信息会存储在中国境外', 'Cloudflare：负责网络加速、安全防护和图片存储', '邮件发送服务：负责投递登录验证码邮件', '服务器托管商：运行网站和数据接口'],
          'GitHub 和 Google 在你使用它们登录时，会按各自的隐私政策处理信息。除上述情况外，只有在法律要求、或为保护用户和网站安全确有必要时，我们才会披露信息。',
        ],
      },
      {
        id: 'public-data',
        title: '网站收录的公开信息',
        blocks: [
          `MCP Field 收录的是公开的开源项目信息，例如项目名称、简介、仓库地址，以及作者的公开用户名和头像，来源是 GitHub 等公开页面和 MCP 目录网站。如果你是项目作者，希望更正或移除与你有关的信息，请发邮件到 ${CONTACT}。`,
        ],
      },
      {
        id: 'retention',
        title: '保存期限',
        blocks: ['账号信息在账号存在期间保存。你申请删除账号后，我们会在 30 天内删除你的账号及相关数据，法律要求保留的除外。'],
      },
      {
        id: 'rights',
        title: '你的权利',
        blocks: [
          [
            '查看和更正：随时联系我们，获取或更正我们保存的你的信息。',
            `删除账号：用注册时的邮箱发邮件到 ${CONTACT}。`,
            '撤回授权：在 GitHub 的 Settings → Applications → Authorized OAuth Apps，或 Google 账号的“第三方应用和服务”中，随时撤销对 MCP Field 的授权。',
            '退出登录：在网站右上角的头像菜单中退出，浏览器里的会话凭据会被清除。',
          ],
          '我们会在 15 个工作日内答复你的请求。',
        ],
      },
      {
        id: 'security',
        title: '信息安全',
        blocks: ['网站全程使用 HTTPS 加密传输；登录验证码一次性有效，过期作废；只有维护网站确有需要的人员才能访问账号数据。没有任何系统能保证绝对安全，如果发生影响你信息安全的事件，我们会及时通知你。'],
      },
      {
        id: 'children',
        title: '未成年人',
        blocks: ['MCP Field 面向开发者，不面向 14 周岁以下的儿童。如果我们发现在没有监护人同意的情况下收集了儿童的信息，会尽快删除。'],
      },
      {
        id: 'changes',
        title: '政策更新',
        blocks: ['本政策可能随网站功能变化而更新。更新后我们会修改本页顶部的生效日期；涉及你权利的重大变化，会在网站上显著提示。'],
      },
      {
        id: 'contact',
        title: '联系我们',
        blocks: [`对本政策或你的个人信息有任何问题，请发邮件到 ${CONTACT}。`],
      },
    ],
  },
  en: {
    title: 'Privacy Policy',
    description: 'How MCP Field collects, uses and protects your information when you browse the site or sign in with GitHub, Google or an email code, and the choices you have.',
    effective: 'Effective October 11, 2026',
    intro: 'MCP Field (mcpfield.com, “we”) is a directory of MCP servers and developer tools. This policy explains what information we handle when you browse the site or use an account, why we handle it, who processes it for us, and how you can control it.',
    toc: 'On this page',
    sections: [
      {
        id: 'browsing',
        title: 'When you browse',
        blocks: [
          "You can browse the site without an account. We don't use third-party analytics or advertising trackers, and we never sell information.",
          'To keep the site secure and fix problems, Cloudflare (our CDN and security provider) and our servers automatically keep access logs, including IP address, browser type, the pages requested and the time. These logs are used only to block attacks and diagnose issues, and are deleted once they are no longer needed for that.',
        ],
      },
      {
        id: 'browser-storage',
        title: 'Data stored in your browser',
        blocks: [
          "The following settings and records stay in your own browser (localStorage / sessionStorage). They aren't sent to us, and clearing your browser data removes them:",
          ['Interface language, light or dark theme, and whether you dismissed the language notice', 'Projects you bookmark', 'Tool lists cached temporarily to make pages load faster', 'Your sign-in session, which keeps you signed in and is cleared when you log out'],
          "Cloudflare may set cookies that are strictly necessary to block malicious traffic. We don't use advertising or tracking cookies ourselves.",
        ],
      },
      {
        id: 'account',
        title: 'When you sign in',
        blocks: [
          'Signing in is optional. It’s used for features that need to know who you are, such as bookmarks, comments and submitting projects. You can use any of the following, and your account is created the first time you sign in:',
          [
            "GitHub: we receive your GitHub user ID, username, display name, avatar and email address. We don't access your repositories or act on your behalf.",
            "Google: we receive your Google account ID, name, avatar and email address (scopes limited to openid, email and profile). We don't access your Gmail, contacts, Drive or any other Google data.",
            'Email code: we receive the email address you enter and send a one-time code to it. The code is valid for 10 minutes and works only once.',
          ],
          'We never receive your GitHub or Google password. Signing in with the same email address through different methods takes you to the same account.',
          'Your account also records when it was created, when you last signed in, and the IP address and browser used to sign in, to protect your account, for example by spotting unusual sign-ins.',
        ],
      },
      {
        id: 'use',
        title: 'How we use information',
        blocks: [
          ['To create and maintain your account and keep you signed in', 'To show your name and avatar on the site, such as in the navigation bar and next to comments you post', 'To send sign-in codes and essential notices about your account security', 'To prevent abuse, spam and attacks', 'To respond to your questions and requests'],
          "We don't use your information for advertising, and we never sell or rent it. Our use and transfer of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.",
        ],
      },
      {
        id: 'sharing',
        title: 'Service providers and sharing',
        blocks: [
          'We share information only with service providers that help us run the site, and only what they need to do their job:',
          ['Supabase: sign-in and account data storage, on servers in Mumbai, India', 'Cloudflare: content delivery, security and image storage', 'An email delivery service: delivers sign-in code emails', 'Our server host: runs the website and its API'],
          "GitHub and Google process information under their own privacy policies when you sign in with them. Beyond this, we disclose information only when the law requires it or when it's genuinely necessary to protect our users or the site.",
        ],
      },
      {
        id: 'public-data',
        title: 'Public information we list',
        blocks: [
          `MCP Field lists public information about open-source projects, such as project names, descriptions and repository links, and authors' public usernames and avatars, gathered from public pages such as GitHub and MCP directory sites. If you're a project author and want information about you corrected or removed, email ${CONTACT}.`,
        ],
      },
      {
        id: 'retention',
        title: 'How long we keep information',
        blocks: ['We keep account information for as long as your account exists. When you ask us to delete your account, we delete it and its associated data within 30 days, unless the law requires us to keep it.'],
      },
      {
        id: 'rights',
        title: 'Your choices and rights',
        blocks: [
          [
            'Access and correction: contact us at any time to get a copy of, or correct, the information we hold about you.',
            `Delete your account: email ${CONTACT} from the address you signed up with.`,
            "Revoke access: remove MCP Field's access at any time under GitHub Settings → Applications → Authorized OAuth Apps, or under “Third-party apps & services” in your Google Account.",
            'Log out: use the avatar menu in the top-right corner. This clears the session from your browser.',
          ],
          'We respond to requests within 15 business days.',
        ],
      },
      {
        id: 'security',
        title: 'Security',
        blocks: ["All traffic to the site is encrypted with HTTPS. Sign-in codes work once and then expire, and only people who need it to maintain the site can access account data. No system is perfectly secure; if an incident affects your information, we'll notify you promptly."],
      },
      {
        id: 'children',
        title: 'Children',
        blocks: ["MCP Field is built for developers and isn't directed at children under 14. If we learn we've collected a child's information without a guardian's consent, we'll delete it promptly."],
      },
      {
        id: 'changes',
        title: 'Changes to this policy',
        blocks: ["We may update this policy as the site changes. We'll change the effective date at the top of this page, and highlight significant changes that affect your rights on the site."],
      },
      {
        id: 'contact',
        title: 'Contact us',
        blocks: [`If you have any questions about this policy or your personal information, email ${CONTACT}.`],
      },
    ],
  },
  ja: {
    title: 'プライバシーポリシー',
    description: 'MCP Field がサイトの閲覧時や、GitHub・Google・メール認証コードでのログイン時にどのような情報を扱い、どう保護するか、またご利用者が管理できることについて説明します。',
    effective: '施行日：2026 年 10 月 11 日',
    intro: 'MCP Field（mcpfield.com、以下「当サイト」）は、MCP サーバーと開発ツールのディレクトリです。本ポリシーでは、サイトの閲覧時やアカウント機能の利用時に当サイトが扱う情報、その目的、処理を委託する事業者、そしてご自身で情報を管理する方法について説明します。',
    toc: '目次',
    sections: [
      {
        id: 'browsing',
        title: '閲覧時',
        blocks: [
          'サイトの閲覧に登録やログインは不要です。第三者のアクセス解析ツールや広告トラッキングは使用しておらず、情報を販売することもありません。',
          'セキュリティの確保と障害対応のため、Cloudflare（当サイトが利用する CDN・セキュリティサービス）と当サイトのサーバーは、IP アドレス、ブラウザの種類、アクセスした URL、日時を含むアクセスログを自動的に記録します。これらのログは攻撃の防止と問題の調査にのみ使用し、必要な期間が過ぎたら削除します。',
        ],
      },
      {
        id: 'browser-storage',
        title: 'ブラウザに保存されるデータ',
        blocks: [
          '次の設定や記録はお使いのブラウザ内（localStorage / sessionStorage）にのみ保存され、当サイトには送信されません。ブラウザのデータを消去すると削除されます：',
          ['表示言語、ライト／ダークテーマ、言語案内を閉じたかどうか', 'ブックマークしたプロジェクト', 'ページの表示を速くするために一時的に保存したツール一覧', 'ログイン後のセッション情報（ログイン状態を保つためのもので、ログアウト時に消去されます）'],
          'Cloudflare が悪意あるトラフィックを防ぐために必要な Cookie を設定する場合があります。当サイト自身は広告やトラッキング目的の Cookie を使用しません。',
        ],
      },
      {
        id: 'account',
        title: 'ログイン時',
        blocks: [
          'ログインは任意です。ブックマーク、コメント、プロジェクトの投稿など、利用者の識別が必要な機能に使います。次のいずれかの方法でログインでき、初回ログイン時にアカウントが自動的に作成されます：',
          [
            'GitHub：GitHub のユーザー ID、ユーザー名、表示名、アバター、メールアドレスを受け取ります。リポジトリへのアクセスや、利用者に代わって操作を行うことはありません。',
            'Google：Google アカウント ID、名前、アバター、メールアドレスを受け取ります（スコープは openid、email、profile のみ）。Gmail、連絡先、ドライブなど、その他の Google データにはアクセスしません。',
            'メール認証コード：入力されたメールアドレスを受け取り、そのアドレスにワンタイムコードを送信します。コードの有効期限は 10 分で、一度だけ使用できます。',
          ],
          'GitHub や Google のパスワードを当サイトが受け取ることはありません。同じメールアドレスであれば、どの方法でログインしても同じアカウントになります。',
          'アカウントには、作成日時、最終ログイン日時、ログイン時の IP アドレスとブラウザの情報も記録されます。これは不審なログインの検知など、アカウントの保護に使用します。',
        ],
      },
      {
        id: 'use',
        title: '情報の利用目的',
        blocks: [
          ['アカウントの作成・維持、およびログイン状態の保持', 'ナビゲーションバーや投稿したコメントの横など、サイト上での名前とアバターの表示', 'ログインコードの送信と、アカウントのセキュリティに関する必要なお知らせ', '不正利用、スパム、攻撃の防止', 'お問い合わせやご依頼への対応'],
          '情報を広告に利用したり、第三者に販売・貸与したりすることはありません。Google API から受け取った情報の利用と移転は、「限定使用」の要件を含め、Google API サービスのユーザーデータに関するポリシー（Google API Services User Data Policy）を遵守します。',
        ],
      },
      {
        id: 'sharing',
        title: '委託先と情報の共有',
        blocks: [
          '情報を提供するのは、サイトの運営を支援する委託先のみで、提供する範囲もそのサービスに必要なものに限ります：',
          ['Supabase：ログインとアカウントデータの保存（サーバーはインドのムンバイにあります）', 'Cloudflare：コンテンツ配信、セキュリティ、画像の保存', 'メール配信サービス：ログインコードのメール配信', 'サーバーのホスティング事業者：ウェブサイトと API の運用'],
          'GitHub と Google は、ログイン時にそれぞれのプライバシーポリシーに従って情報を処理します。上記以外では、法令で求められる場合や、利用者やサイトの安全を守るために本当に必要な場合にのみ情報を開示します。',
        ],
      },
      {
        id: 'public-data',
        title: '掲載している公開情報',
        blocks: [
          `MCP Field は、プロジェクト名、説明、リポジトリの URL、作者の公開ユーザー名とアバターなど、オープンソースプロジェクトに関する公開情報を、GitHub や MCP ディレクトリサイトなどの公開ページから収集して掲載しています。プロジェクトの作者で、ご自身に関する情報の訂正や削除を希望される場合は、${CONTACT} までご連絡ください。`,
        ],
      },
      {
        id: 'retention',
        title: '保存期間',
        blocks: ['アカウント情報はアカウントが存在する間保存します。アカウントの削除をご依頼いただいた場合、法令で保存が義務付けられているものを除き、30 日以内にアカウントと関連データを削除します。'],
      },
      {
        id: 'rights',
        title: '利用者の権利',
        blocks: [
          [
            '開示・訂正：保有している情報の開示や訂正は、いつでもお問い合わせください。',
            `アカウントの削除：登録したメールアドレスから ${CONTACT} までご連絡ください。`,
            'アクセス権の取り消し：GitHub の Settings → Applications → Authorized OAuth Apps、または Google アカウントの「サードパーティ製のアプリとサービス」から、いつでも MCP Field へのアクセスを取り消せます。',
            'ログアウト：画面右上のアバターメニューからログアウトすると、ブラウザ内のセッション情報が消去されます。',
          ],
          'ご依頼には 15 営業日以内に回答します。',
        ],
      },
      {
        id: 'security',
        title: 'セキュリティ',
        blocks: ['サイトとの通信はすべて HTTPS で暗号化しています。ログインコードは一度だけ有効で、期限が切れると無効になります。アカウントデータにアクセスできるのは、サイトの保守に必要な者に限られます。完全に安全なシステムは存在しませんが、情報に影響する事故が発生した場合は速やかにお知らせします。'],
      },
      {
        id: 'children',
        title: '未成年の方へ',
        blocks: ['MCP Field は開発者向けのサービスであり、14 歳未満の子どもを対象としていません。保護者の同意なく子どもの情報を収集したことが判明した場合は、速やかに削除します。'],
      },
      {
        id: 'changes',
        title: 'ポリシーの変更',
        blocks: ['サイトの変更に合わせて本ポリシーを更新することがあります。更新時はページ上部の施行日を変更し、利用者の権利に関わる重要な変更はサイト上で目立つ形でお知らせします。'],
      },
      {
        id: 'contact',
        title: 'お問い合わせ',
        blocks: [`本ポリシーや個人情報に関するご質問は、${CONTACT} までメールでお問い合わせください。`],
      },
    ],
  },
}

/** 正文里的联系邮箱做成可点击的链接 */
function Text({ text }: { text: string }) {
  const parts = text.split(CONTACT)
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {part}
          {i < parts.length - 1 && (
            <a href={`mailto:${CONTACT}`} className="text-ink underline decoration-fg/30 underline-offset-4 transition-colors hover:decoration-fg/70">
              {CONTACT}
            </a>
          )}
        </Fragment>
      ))}
    </>
  )
}

export default function Privacy() {
  const { locale } = useI18n()
  const doc = DOCS[locale]
  return (
    <Container className="pb-24 pt-12 sm:pt-16">
      <Seo title={`${doc.title} · MCP Field`} description={doc.description} path="/privacy" />
      <header className="max-w-[720px] lg:ml-[268px]">
        <h1 className="text-[32px] font-bold tracking-tight sm:text-[40px]">{doc.title}</h1>
        <p className="mt-3 text-sm text-text3">{doc.effective}</p>
        <p className="mt-6 text-[16px] leading-[1.85] text-text2">{doc.intro}</p>
      </header>
      <div className="mt-12 lg:grid lg:grid-cols-[220px_minmax(0,720px)] lg:gap-12">
        <nav aria-label={doc.toc} className="hidden lg:block">
          <div className="sticky top-[calc(var(--nav-h,110px)+24px)]">
            <div className="text-xs text-text3">{doc.toc}</div>
            <ul className="mt-3 flex flex-col gap-2 border-l border-line">
              {doc.sections.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="-ml-px block border-l border-transparent pl-4 text-sm text-text2 transition-colors hover:border-fg/40 hover:text-ink">
                    {s.title}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </nav>
        <article className="flex flex-col gap-11">
          {doc.sections.map((s) => (
            <section key={s.id} id={s.id} className="scroll-mt-[calc(var(--nav-h,110px)+24px)]">
              <h2 className="text-[19px] font-semibold tracking-tight">{s.title}</h2>
              <div className="mt-4 flex flex-col gap-4 text-[15px] leading-[1.85] text-text2">
                {s.blocks.map((b, i) =>
                  typeof b === 'string' ? (
                    <p key={i}>
                      <Text text={b} />
                    </p>
                  ) : (
                    <ul key={i} className="flex flex-col gap-2.5">
                      {b.map((item) => (
                        <li key={item} className="relative pl-5 before:absolute before:left-1 before:top-[0.8em] before:size-1.5 before:rounded-full before:bg-fg/30">
                          <Text text={item} />
                        </li>
                      ))}
                    </ul>
                  ),
                )}
              </div>
            </section>
          ))}
        </article>
      </div>
    </Container>
  )
}
