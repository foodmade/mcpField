"""
生成首页、目录页等没有条目图标的页面用的分享图（public/og/<语言>.png，1200×630，og:image / twitter 大图卡片）。
修改 template.html 的文案或样式后重新运行：
  python3 scripts/og-image/render.py
需要：pip install playwright、本机装有 Google Chrome（中文、日文用 macOS 自带的苹方、冬青黑体）。
"""
import asyncio, pathlib
from playwright.async_api import async_playwright

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE.parents[1] / 'public' / 'og'
LOCALES = ['zh', 'en', 'ja']


async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel='chrome')
        page = await browser.new_page(viewport={'width': 1200, 'height': 630})
        for locale in LOCALES:
            await page.goto(f'{(HERE / "template.html").as_uri()}?locale={locale}')
            await page.evaluate('document.fonts.ready')
            await page.screenshot(path=str(OUT / f'{locale}.png'))
            print(f'已生成 public/og/{locale}.png')
        await browser.close()


asyncio.run(main())
