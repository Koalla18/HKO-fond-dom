import type { Metadata } from "next"
import { Suspense } from "react"
import { ApplicationsView } from "@/components/applications/applications-view"

export const metadata: Metadata = { title: "Заявки" }

export default function ApplicationsPage() {
  return (
    <Suspense>
      <ApplicationsView />
    </Suspense>
  )
}
