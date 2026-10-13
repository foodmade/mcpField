"""
生成 3D 图标的静态图（src/assets/category-icons/<模型键>.webp，首页热门分类和各目录头部在用）：服务端渲染和动画加载前显示，
内容就是 src/fx/category3d/models.ts 里各模型动画的第一帧。新增或修改模型后重新运行：
  npm run dev                                         # 先启动开发服务器（默认 5288 端口）
  python3 scripts/category-icons/render.py            # 全部模型
  python3 scripts/category-icons/render.py dev-tools  # 只渲染指定模型
需要：pip install playwright、本机装有 Google Chrome。可用环境变量 DEV_URL 指定开发服务器地址。
"""
import asyncio, base64, os, pathlib, sys
from playwright.async_api import async_playwright

OUT = pathlib.Path(__file__).resolve().parents[2] / 'src' / 'assets' / 'category-icons'
DEV = os.environ.get('DEV_URL', 'http://localhost:5288').rstrip('/')
# 卡片上最大的图标显示 230px，按 2 倍像素渲染
PX = 460


async def main(only: list[str]):
    OUT.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel='chrome')
        page = await browser.new_page()
        # 同源的空白页，好让页面直接 import 开发服务器编译好的模块
        await page.route(f'{DEV}/__category-icons', lambda r: r.fulfill(status=200, content_type='text/html', body='<!doctype html><html><body></body></html>'))
        await page.goto(f'{DEV}/__category-icons')
        shots = await page.evaluate(
            '''async ([only, px]) => {
              const [{ snapshot }, { MODELS }] = await Promise.all([import('/src/fx/category3d/engine.ts'), import('/src/fx/category3d/models.ts')])
              return Object.keys(MODELS).filter((id) => !only.length || only.includes(id)).map((id) => [id, snapshot(id, px)])
            }''',
            [only, PX],
        )
        for slug, url in shots:
            (OUT / f'{slug}.webp').write_bytes(base64.b64decode(url.split(',', 1)[1]))
            print(slug)
        await browser.close()


asyncio.run(main(sys.argv[1:]))
