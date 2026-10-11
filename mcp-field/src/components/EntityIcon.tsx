import { useState } from 'react'
import clsx from 'clsx'
import { Tile } from './ui'

/**
 * 条目图标：底层始终是首字母色块，图片加载完成后再淡入覆盖；
 * 图片加载慢（第三方图床在部分网络下很慢）或失败时，看到的就是首字母色块，而不是空白方块。
 */
export function EntityIcon({ name, src, color, size = 40, className }: { name: string; src: string | null; color: string; size?: number; className?: string }) {
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>('loading')
  const radius = size * 0.26
  return (
    <div className={clsx('relative shrink-0 overflow-hidden', className)} style={{ width: size, height: size, borderRadius: radius }}>
      <Tile label={Array.from(name.trim())[0]?.toUpperCase() ?? '?'} bg={color} size={size} />
      {src && state !== 'failed' && (
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          // 服务端渲染的图片可能在水合前就加载完（或失败），这时收不到 onLoad / onError，挂载时补查一次
          ref={(img) => {
            if (img?.complete && state === 'loading') setState(img.naturalWidth > 0 ? 'loaded' : 'failed')
          }}
          onLoad={() => setState('loaded')}
          onError={() => setState('failed')}
          className={clsx('absolute inset-0 size-full bg-white object-cover transition-opacity duration-300', state === 'loaded' ? 'opacity-100' : 'opacity-0')}
        />
      )}
    </div>
  )
}
