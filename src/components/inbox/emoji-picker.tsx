"use client"

import { Smile } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

/** Смайлики, которые реально пишут в переписке фонда: эмоции, благодарности, животные. */
const GROUPS: { id: string; title: string; icon: string; items: string[] }[] = [
  {
    id: "faces",
    title: "Смайлы",
    icon: "🙂",
    items: "😊 🙂 😀 😃 😄 😁 😆 😅 🤣 😂 🥲 ☺️ 😇 🥰 😍 🤗 🤩 😘 😌 😉 🙃 😋 😎 🤓 🧐 🤔 🤨 😐 😶 🙄 😏 😬 😮‍💨 😔 😕 🙁 ☹️ 😟 😢 😭 🥺 😩 😫 😤 😠 😳 😱 😨 😰 😥 😴 🤒 🤕 🥳 🤝".split(" "),
  },
  {
    id: "hearts",
    title: "Сердца и жесты",
    icon: "❤️",
    items: "❤️ 🧡 💛 💚 💙 💜 🤎 🖤 🤍 💖 💗 💓 💞 💕 💝 ❣️ ❤️‍🩹 🙏 👍 👎 👌 ✌️ 🤞 👋 👏 🙌 💪 🫶 🤲 ✊ ☝️ 👆 👇 👉 👈 ✋ 🖐️ 🤙".split(" "),
  },
  {
    id: "animals",
    title: "Животные",
    icon: "🐾",
    items: "🐶 🐕 🦮 🐕‍🦺 🐩 🐺 🐱 🐈 🐈‍⬛ 🐾 🐰 🐹 🐭 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐦 🐤 🦆 🦉 🐢 🐍 🐠 🐟 🦔 🦜 🐴 🐑 🐐".split(" "),
  },
  {
    id: "things",
    title: "Разное",
    icon: "✅",
    items: "✅ ☑️ ✔️ ❌ ❗ ❓ ⚠️ 🆘 🚑 🏥 💊 💉 🩹 🩺 🏠 🏡 🚗 🚕 📍 🗺️ 📞 📱 ✉️ 📩 📷 📸 🎁 🛍️ 🥫 🍖 🦴 🧸 🎉 🎈 ⭐ 🌟 ✨ ☀️ 🌈 🍀 ⏰ 📅 💰 💳 📝 📎".split(" "),
  },
]

const RECENT_KEY = "dom-emoji-recent"

function readRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[]
  } catch {
    return []
  }
}

export function EmojiPicker({ onPick, disabled }: { onPick: (emoji: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const [recent, setRecent] = useState<string[]>([])
  const [tab, setTab] = useState("faces")

  const groups = recent.length ? [{ id: "recent", title: "Недавние", icon: "🕘", items: recent }, ...GROUPS] : GROUPS
  const current = groups.find((g) => g.id === tab) ?? groups[0]

  function pick(emoji: string) {
    const next = [emoji, ...recent.filter((e) => e !== emoji)].slice(0, 24)
    setRecent(next)
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next))
    } catch {}
    onPick(emoji)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        if (v) {
          const r = readRecent()
          setRecent(r)
          setTab(r.length ? "recent" : "faces")
        }
        setOpen(v)
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" disabled={disabled} aria-label="Смайлики">
          <Smile />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-[320px] p-2" onOpenAutoFocus={(e) => e.preventDefault()}
        // Курсор возвращается в поле после каждого смайлика — окно при этом не закрываем.
        onFocusOutside={(e) => e.preventDefault()}
      >
        <div className="mb-1.5 flex gap-1" role="tablist" aria-label="Группы смайликов">
          {groups.map((g) => (
            <button
              key={g.id}
              type="button"
              role="tab"
              aria-selected={g.id === current.id}
              title={g.title}
              onClick={() => setTab(g.id)}
              className={cn("flex size-8 items-center justify-center rounded-lg text-base transition-colors", g.id === current.id ? "bg-white/15" : "hover:bg-white/10")}
            >
              {g.icon}
            </button>
          ))}
        </div>
        <p className="px-1 pb-1 text-[11px] text-muted-foreground">{current.title}</p>
        <div className="grid max-h-56 grid-cols-8 gap-0.5 overflow-y-auto scroll-thin" data-emoji-grid>
          {current.items.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => pick(e)}
              className="flex size-9 items-center justify-center rounded-lg text-xl leading-none transition-transform hover:scale-110 hover:bg-white/10"
              aria-label={e}
            >
              {e}
            </button>
          ))}
        </div>
        <p className="px-1 pt-1.5 text-[11px] text-muted-foreground">Можно нажимать несколько подряд — окно не закроется.</p>
      </PopoverContent>
    </Popover>
  )
}
