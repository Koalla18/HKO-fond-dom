import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto"

function appKey(): Buffer {
  const raw = process.env.APP_SECRET
  if (!raw) throw new Error("APP_SECRET не задан — без него нельзя хранить токены каналов")
  const key = Buffer.from(raw, "base64")
  if (key.length !== 32) throw new Error("APP_SECRET должен быть 32 байтами в base64")
  return key
}

/** AES-256-GCM: v1:<iv>:<tag>:<шифротекст>, всё в base64url. */
export function encryptJson(value: unknown): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", appKey(), iv)
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), body.toString("base64url")].join(":")
}

export function decryptJson<T = Record<string, string>>(payload: string | null | undefined): T {
  if (!payload) return {} as T
  const [version, iv, tag, body] = payload.split(":")
  if (version !== "v1" || !iv || !tag || !body) throw new Error("Повреждённые секреты канала")
  const decipher = createDecipheriv("aes-256-gcm", appKey(), Buffer.from(iv, "base64url"))
  decipher.setAuthTag(Buffer.from(tag, "base64url"))
  const plain = Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()])
  return JSON.parse(plain.toString("utf8")) as T
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url")
}

const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, 64, SCRYPT, (err, key) => (err ? reject(err) : resolve(key))),
  )
}

/** scrypt$N$r$p$<соль>$<хеш> — медленный хеш паролей без нативных зависимостей. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await scryptAsync(password, salt)
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64url"), key.toString("base64url")].join("$")
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, , , , salt, hash] = stored.split("$")
  if (algo !== "scrypt" || !salt || !hash) return false
  const key = await scryptAsync(password, Buffer.from(salt, "base64url"))
  const expected = Buffer.from(hash, "base64url")
  return key.length === expected.length && timingSafeEqual(key, expected)
}

/** Маска для показа сохранённого секрета: ••••1234 */
export function maskSecret(value: string | undefined): string | null {
  if (!value) return null
  return value.length <= 4 ? "••••" : `••••${value.slice(-4)}`
}
