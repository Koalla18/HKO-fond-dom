import type { Metadata } from "next"
import { Suspense } from "react"
import { ChannelsView } from "@/components/channels/channels-view"

export const metadata: Metadata = { title: "Каналы" }

export default function ChannelsPage() {
  return (
    <Suspense>
      <ChannelsView />
    </Suspense>
  )
}
