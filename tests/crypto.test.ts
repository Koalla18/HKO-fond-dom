import { describe, expect, it } from "vitest"
import { mergeSecrets } from "@/lib/channels/store"
import { decryptJson, encryptJson, hashPassword, maskSecret, verifyPassword } from "@/lib/crypto"

describe("секреты каналов", () => {
  it("шифруются и расшифровываются, в базе нет открытого текста", () => {
    const sealed = encryptJson({ token: "vk1.a.secret" })
    expect(sealed).not.toContain("secret")
    expect(decryptJson(sealed)).toEqual({ token: "vk1.a.secret" })
  })
  it("подделанный шифротекст не расшифровывается", () => {
    const sealed = encryptJson({ token: "x" })
    const parts = sealed.split(":")
    parts[3] = Buffer.from("tampered").toString("base64url")
    expect(() => decryptJson(parts.join(":"))).toThrow()
  })
  it("пустое поле и маска из формы не стирают сохранённый ключ", () => {
    const merged = decryptJson(mergeSecrets({ token: "old" }, { token: "••••old", password: "", other: "new" }))
    expect(merged).toEqual({ token: "old", other: "new" })
    expect(maskSecret("abcdef1234")).toBe("••••1234")
  })
})

describe("пароли сотрудников", () => {
  it("scrypt: верный пароль проходит, неверный — нет", async () => {
    const hash = await hashPassword("пароль-сотрудника")
    expect(hash.startsWith("scrypt$")).toBe(true)
    expect(await verifyPassword("пароль-сотрудника", hash)).toBe(true)
    expect(await verifyPassword("другой", hash)).toBe(false)
  })
})
