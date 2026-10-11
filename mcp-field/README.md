# MCP Field 前端

React 19 + React Router 8（框架模式，服务端渲染）+ Tailwind CSS 4。数据来自同机部署的 API（`mcp-field-crawler` 项目的 `npm run api`，默认 `http://127.0.0.1:3100`）。

## 命令

```bash
npm run dev        # 开发：http://localhost:5288（Vite 中间件 + 服务端渲染）
npm run build      # 生产构建：build/client（静态资源）+ build/server（服务端）
npm start          # 生产启动：默认 3000 端口，PORT=… 可改
npm run typecheck  # 生成路由类型后做类型检查
npm run lint
```

环境变量：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `3000`（`npm run dev` 固定 5288） | 前端服务端口 |
| `API_ORIGIN` | `http://127.0.0.1:3100` | API 地址：服务端 loader 直接访问；浏览器的 `/api/*` 由前端服务反向代理到这里 |
| `VITE_SUPABASE_URL` | — | Supabase 项目地址（登录用），构建时打包进前端，写在 `.env`（见 `.env.example`） |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | — | Supabase 的 Publishable key（可公开） |

## 登录（Supabase Auth）

登录页 `/login`（`src/pages/Login.tsx`）支持 GitHub、Google 和邮箱验证码，浏览器直接调用 Supabase Auth，会话存在 localStorage。
页面 HTML 会被 CDN 缓存，登录状态只在浏览器端读取（`src/lib/auth.ts` 的 `useSession`）。Supabase 后台需要配置：

- Authentication → URL Configuration：Site URL 填 `https://mcpfield.com`，Redirect URLs 加 `https://mcpfield.com/**` 和 `http://localhost:5288/**`
- Authentication → Sign In / Providers：启用 GitHub、Google，填各自的 Client ID / Secret；两边的回调地址都是 `https://<项目>.supabase.co/auth/v1/callback`
- Email：OTP 长度 6 位、有效期 600 秒（与 `OTP_LENGTH`、`OTP_MINUTES` 一致）；Magic Link 和 Confirm signup 两个邮件模板都换成 [`supabase/email-otp.html`](supabase/email-otp.html)（显示验证码，按用户语言切换中英日）；正式环境配置自定义 SMTP（Supabase 自带的发信只能发给项目成员，每小时只能发几封）

背景"光之田"是 `src/components/login/field.glsl`，与设计稿共用同一份着色器。

## 结构

- `server.js`：Express 服务。开发时挂 Vite 中间件；生产时提供带哈希的静态资源（缓存 1 年）、反代 `/api`、交给 React Router 渲染页面。
- `src/routes.ts`：路由表。中文无前缀，英文 `/en`、日文 `/ja`，所有页面挂在可选的 `:lang` 段下，由 `routes/site.tsx` 校验语言。
- `src/pages/*`：页面路由模块。数据在 `loader` 里于服务端取回（`src/lib/api/loaders.ts`），组件读 `loaderData`；详情不存在时抛 404。
- `src/entry.server.tsx`：渲染入口。爬虫等全部内容就绪再输出；按状态码设置缓存头。
- `src/components/Seo.tsx`：每个页面的 title、description、canonical、hreflang、Open Graph 和 JSON-LD。
- `src/routes/robots.ts`、`sitemap-index.ts`、`sitemap.ts`：`/robots.txt`、`/sitemap.xml`、`/sitemaps/*.xml`（详情页按"类型 × 语言 × 每 1 万条"拆分，数据来自 API 的 `/api/sitemap`）。

## SEO 约定

- 正式域名 `https://mcpfield.com`（`src/lib/seo.ts` 的 `SITE`），canonical、hreflang、sitemap 都用绝对地址。
- 目录页：`category` / `view` / `type` / `page` 可被收录，canonical 指向自身；`sort` 不进 canonical；带搜索词 `q` 的页面 `noindex, follow`。
- 侧栏分类、视图、类型和分页都是真实链接，爬虫不执行 JS 也能逐层抓取。
- 不按浏览器语言自动跳转；语言提示条只在浏览器里显示。
- 浏览器相关的状态（localStorage、sessionStorage、浏览器语言）都通过 `useSyncExternalStore` 读取，服务端渲染和水合时为空，避免水合不一致。
- 首屏内容在服务端直接以最终状态输出；入场动画只用于水合之后挂载的内容（站内跳转、展开等），见 `src/fx/hydration.ts`。

## 部署

线上部署方式、服务器目录和 `mcpfield` 运维命令见仓库根目录的 [`deploy/README.md`](../deploy/README.md)。
