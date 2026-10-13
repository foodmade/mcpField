/** 3D 图标的静态图（scripts/category-icons/render.py 生成，即动画第一帧）：模型键 → 带哈希的图片地址 */
const POSTERS: Record<string, string> = Object.fromEntries(
  Object.entries(import.meta.glob<string>('../../assets/category-icons/*.webp', { eager: true, query: '?url', import: 'default' })).map(([path, url]) => [
    path.slice(path.lastIndexOf('/') + 1, -'.webp'.length),
    url,
  ]),
)

export const posterOf = (model: string): string | undefined => POSTERS[model]
