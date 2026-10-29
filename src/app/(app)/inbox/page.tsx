import type { Metadata } from "next"
import { Suspense } from "react"
import { InboxView } from "@/components/inbox/inbox-view"

export const metadata: Metadata = { title: "Входящие" }

export default function InboxPage() {
  return (
    <Suspense>
      <InboxView />
    </Suspense>
  )
}
