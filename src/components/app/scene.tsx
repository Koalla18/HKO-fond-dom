"use client"

import { Check, ImageIcon } from "lucide-react"
import { useSyncExternalStore } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

/** Фоны обзора: свои файлы в /public/scene (Unsplash License, авторы — в credits.json). */
export const SCENES = [
  { id: "window", title: "У окна", author: "Alexis Antoine", focus: "30% 55%" },
  { id: "candle", title: "Вечер", author: "Bernd Dittrich", focus: "35% 50%" },
  { id: "shepherd", title: "Свет", author: "Lesly Juarez", focus: "50% 35%" },
  { id: "cat", title: "Кот", author: "Jason Mayer", focus: "65% 50%" },
  { id: "none", title: "Без фото", author: null, focus: "50% 50%" },
] as const

export type SceneId = (typeof SCENES)[number]["id"]

const KEY = "dom-scene"
const listeners = new Set<() => void>()

function read(): SceneId {
  try {
    const v = localStorage.getItem(KEY)
    return SCENES.some((s) => s.id === v) ? (v as SceneId) : "window"
  } catch {
    return "window"
  }
}

export function useScene(): [SceneId, (id: SceneId) => void] {
  const scene = useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    read,
    () => "window" as SceneId,
  )
  const set = (id: SceneId) => {
    try {
      localStorage.setItem(KEY, id)
    } catch {}
    listeners.forEach((l) => l())
  }
  return [scene, set]
}

/** Фото дома на весь экран — под всеми разделами кабинета. */
export function SceneBackground({ scene }: { scene: SceneId }) {
  const meta = SCENES.find((s) => s.id === scene) ?? SCENES[0]
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[#070b18]">
      {scene !== "none" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={scene} src={`/scene/${scene}.webp`} alt="" className="scene-photo h-full w-full object-cover" style={{ objectPosition: meta.focus }} />
      ) : (
        <div className="absolute inset-0">
          <div className="absolute -top-40 -left-40 size-[42rem] rounded-full bg-[#05c7f2]/25 blur-[120px]" />
          <div className="absolute top-1/3 -right-32 size-[36rem] rounded-full bg-[#a185d8]/25 blur-[120px]" />
          <div className="absolute -bottom-40 left-1/3 size-[30rem] rounded-full bg-[#0a7d9e]/30 blur-[120px]" />
        </div>
      )}
      <div className="absolute inset-0 bg-[linear-gradient(115deg,rgba(6,10,26,.74)_0%,rgba(6,10,26,.48)_50%,rgba(6,10,26,.66)_100%)]" />
      <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[#060a1a]/70 to-transparent" />
    </div>
  )
}

export function ScenePicker({ scene, onChange }: { scene: SceneId; onChange: (id: SceneId) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="glass-chip flex size-10 items-center justify-center rounded-full" aria-label="Фон кабинета">
          <ImageIcon className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3">
        <p className="text-sm font-medium">Фон кабинета</p>
        <div className="grid grid-cols-3 gap-2">
          {SCENES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onChange(s.id)}
              className={cn("group relative overflow-hidden rounded-xl border-2 text-left", scene === s.id ? "border-primary" : "border-transparent")}
              aria-pressed={scene === s.id}
            >
              {s.id === "none" ? (
                <span className="block aspect-[4/3] bg-[radial-gradient(circle_at_30%_30%,#05c7f2_0,transparent_55%),radial-gradient(circle_at_80%_70%,#a185d8_0,transparent_55%),#0c143b]" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/scene/${s.id}-thumb.webp`} alt="" className="block aspect-[4/3] w-full object-cover" />
              )}
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-1.5 pt-3 pb-1 text-[11px] font-medium text-white">{s.title}</span>
              {scene === s.id && <Check className="absolute top-1 right-1 size-4 rounded-full bg-primary p-0.5 text-white" />}
            </button>
          ))}
        </div>
        <p className="text-[11px] leading-snug text-muted-foreground">Фото: Alexis Antoine, Bernd Dittrich, Lesly Juarez, Jason Mayer — Unsplash. Выбор сохраняется на этом устройстве.</p>
      </PopoverContent>
    </Popover>
  )
}
