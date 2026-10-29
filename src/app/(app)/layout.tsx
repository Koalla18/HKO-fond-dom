import { redirect } from "next/navigation"
import { AppShell } from "@/components/app/app-shell"
import { getSessionUser } from "@/lib/auth"
import { getSetting } from "@/lib/settings"

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await getSessionUser()
  if (!user) redirect("/login")
  const org = await getSetting("org")
  return (
    <AppShell user={user} orgName={org.name} logoUrl={org.logoUrl}>
      {children}
    </AppShell>
  )
}
