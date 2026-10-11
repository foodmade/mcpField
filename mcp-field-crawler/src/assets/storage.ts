import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * 图片的对象存储（策略模式）：正式环境用 Cloudflare R2，本地调试写到目录。
 * 以后换成其他存储（例如国内对象存储）只需再实现一个。
 */
export interface AssetStorage {
  readonly name: string
  exists(key: string): Promise<boolean>
  put(key: string, body: Buffer, contentType: string): Promise<void>
  publicUrl(key: string): string
}

/** 文件名按内容哈希生成，内容不变就永远不变，可以长期缓存 */
const CACHE_CONTROL = 'public, max-age=31536000, immutable'

export interface R2Config {
  accountId: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  /** 公开访问地址：自定义域名或 r2.dev 地址 */
  publicBaseUrl: string
}

/** Cloudflare R2：通过兼容 S3 的接口上传 */
export class R2Storage implements AssetStorage {
  readonly name = 'r2'
  private readonly client: S3Client
  private readonly base: string

  constructor(private readonly config: R2Config) {
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    })
    this.base = config.publicBaseUrl.replace(/\/+$/, '')
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }))
      return true
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
      if (status === 404) return false
      throw error
    }
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.config.bucket, Key: key, Body: body, ContentType: contentType, CacheControl: CACHE_CONTROL }))
  }

  publicUrl(key: string): string {
    return `${this.base}/${key}`
  }
}

/** 本地目录：没有配置 R2 时用于调试 */
export class LocalStorage implements AssetStorage {
  readonly name = 'local'
  private readonly root: string

  constructor(root: string) {
    this.root = resolve(root)
  }

  async exists(key: string): Promise<boolean> {
    return stat(join(this.root, key)).then(
      () => true,
      () => false,
    )
  }

  async put(key: string, body: Buffer): Promise<void> {
    const path = join(this.root, key)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, body)
  }

  publicUrl(key: string): string {
    return pathToFileURL(join(this.root, key)).toString()
  }
}
