import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { SettingsView } from "@/components/settings/settings-view"
import { getSessionUser } from "@/lib/auth"

export const metadata: Metadata = { title: "Настройки" }

export default async function SettingsPage() {
  const user = await getSessionUser()
  if (user?.role !== "admin") redirect("/inbox")
  return <SettingsView meId={user.id} />
}
