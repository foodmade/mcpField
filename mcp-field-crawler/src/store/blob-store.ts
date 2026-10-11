import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'

/** 原始文档存储：本地目录实现；以后换成 S3 / R2 只需另写一个实现 */
export interface BlobStore {
  put(key: string, content: string): Promise<void>
  get(key: string): Promise<string>
}

export class FsBlobStore implements BlobStore {
  constructor(private readonly root: string) {}

  async put(key: string, content: string): Promise<void> {
    const path = join(this.root, key)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, gzipSync(content))
  }

  async get(key: string): Promise<string> {
    return gunzipSync(await readFile(join(this.root, key))).toString('utf8')
  }
}
