import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto'

/* 后台账号的密码哈希：Node 自带的 scrypt，格式 scrypt$N$r$p$盐$哈希（都是 base64url），参数变了旧哈希照样能校验 */

const PARAMS = { N: 16384, r: 8, p: 1 }
const KEY_LENGTH = 32

function derive(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, { ...options, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key))))
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await derive(password, salt, PARAMS)
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64url'), key.toString('base64url')].join('$')
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split('$')
  if (scheme !== 'scrypt' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64url')
  const actual = await derive(password, Buffer.from(salt, 'base64url'), { N: Number(n), r: Number(r), p: Number(p) })
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

/** 密码要求：8 到 128 个字符 */
export function passwordProblem(password: string): string | null {
  if (password.length < 8) return '密码至少 8 个字符'
  if (password.length > 128) return '密码最多 128 个字符'
  return null
}
