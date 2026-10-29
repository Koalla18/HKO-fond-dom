import { describe, expect, it } from "vitest"
import { presetOf } from "@/lib/agent/presets"

describe("пресет Timeweb Cloud AI", () => {
  it("адрес — свой у каждого агента, модель задана в самом агенте, данные не обезличиваются", () => {
    const tw = presetOf("timeweb")!
    expect(tw.baseUrl).toBe("")
    expect(tw.needsUrl).toContain("agent.timeweb.cloud")
    expect(tw.model).toBeTruthy()
    expect(tw.dataInRussia).toBe(true)
    expect(presetOf("deepseek")!.dataInRussia).toBe(false)
  })
})
