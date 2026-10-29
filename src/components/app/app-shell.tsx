"use client"

import { BarChart3, ChevronsUpDown, ClipboardList, Inbox, LogOut, Plug, Settings, Users } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Suspense } from "react"
import useSWR, { SWRConfig } from "swr"
import { HouseMark } from "@/components/app/brand"
import { ChannelIcon } from "@/components/app/channel-icon"
import { SceneBackground, ScenePicker, useScene } from "@/components/app/scene"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
} from "@/components/ui/sidebar"
import { apiFetch, fetcher, useLiveUpdates } from "@/lib/client"
import { initials } from "@/lib/format"
import type { SessionUser } from "@/lib/auth"
import type { ApplicationListResponse, ChannelListItem, RequestListResponse } from "@/lib/api-types"

function LiveBridge() {
  useLiveUpdates()
  return null
}

function Nav({ user }: { user: SessionUser }) {
  const pathname = usePathname()
  const params = useSearchParams()
  const { data: list } = useSWR<RequestListResponse>("/api/requests?view=active&limit=1", fetcher)
  const { data: channels } = useSWR<{ channels: ChannelListItem[] }>("/api/channels", fetcher)
  const { data: apps } = useSWR<ApplicationListResponse>("/api/applications?state=open&limit=1", fetcher)
  const activeChannel = pathname === "/inbox" ? params.get("channel") : null
  const items = [
    { href: "/inbox", label: "Входящие", icon: Inbox, badge: list?.counts.active },
    { href: "/applications", label: "Заявки", icon: ClipboardList, badge: apps?.byStage.new },
    { href: "/dashboard", label: "Обзор", icon: BarChart3 },
    { href: "/contacts", label: "Люди", icon: Users },
    { href: "/channels", label: "Каналы", icon: Plug },
    ...(user.role === "admin" ? [{ href: "/settings", label: "Настройки", icon: Settings }] : []),
  ]
  // Показываем включённые каналы и те, где есть активные заявки (даже если канал выключили).
  const connected = (channels?.channels ?? []).filter((c) => c.enabled || list?.byChannel[c.id])
  return (
    <SidebarContent>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            {items.map((item) => (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton asChild isActive={pathname.startsWith(item.href) && !(item.href === "/inbox" && activeChannel)} tooltip={item.label}>
                  <Link prefetch={false} href={item.href}>
                    <item.icon />
                    <span>{item.label}</span>
                  </Link>
                </SidebarMenuButton>
                {item.badge ? <SidebarMenuBadge>{item.badge}</SidebarMenuBadge> : null}
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
      <SidebarGroup>
        <SidebarGroupLabel>Источники</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {channels && connected.length === 0 && (
              <p className="px-2 py-1 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
                Каналы ещё не подключены
              </p>
            )}
            {connected.map((c) => (
              <SidebarMenuItem key={c.id}>
                <SidebarMenuButton asChild isActive={activeChannel === c.id} tooltip={c.name}>
                  <Link prefetch={false} href={`/inbox?channel=${c.id}`}>
                    <ChannelIcon kind={c.kind} size="xs" />
                    <span className={c.enabled ? "truncate" : "truncate text-muted-foreground"}>{c.name}</span>
                    {c.status === "error" && <span className="ml-auto size-1.5 shrink-0 rounded-full bg-destructive" aria-label="ошибка подключения" />}
                  </Link>
                </SidebarMenuButton>
                {list?.byChannel[c.id] ? <SidebarMenuBadge>{list.byChannel[c.id]}</SidebarMenuBadge> : null}
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </SidebarContent>
  )
}

export function AppShell({ user, orgName, logoUrl, children }: { user: SessionUser; orgName: string; logoUrl: string | null; children: React.ReactNode }) {
  const router = useRouter()
  const [scene, setScene] = useScene()
  async function logout() {
    await apiFetch("/api/auth/logout", { method: "POST" }).catch(() => {})
    router.replace("/login")
  }
  return (
    <SWRConfig value={{ fetcher, revalidateOnFocus: true }}>
      <LiveBridge />
      <SceneBackground scene={scene} />
      <SidebarProvider>
        <Sidebar collapsible="icon">
          <SidebarHeader>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton size="lg" asChild>
                  <Link prefetch={false} href="/inbox" aria-label={orgName}>
                    <HouseMark className="size-8 shrink-0 text-primary" />
                    <div className="grid min-w-0 gap-0.5 leading-tight">
                      {logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={logoUrl} alt={orgName} data-org-logo className="h-7 w-auto max-w-full object-contain object-left" />
                      ) : (
                        <span className="truncate font-semibold">{orgName}</span>
                      )}
                      <span className="truncate text-xs text-muted-foreground">Единое окно заявок</span>
                    </div>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarHeader>
          <Suspense>
            <Nav user={user} />
          </Suspense>
          <SidebarFooter>
            <div className="flex items-center justify-between px-2 group-data-[collapsible=icon]:hidden">
              <span className="text-xs text-sidebar-foreground/60">Фон кабинета</span>
              <ScenePicker scene={scene} onChange={setScene} />
            </div>
            <SidebarMenu>
              <SidebarMenuItem>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <SidebarMenuButton size="lg">
                      <Avatar className="size-8 rounded-lg">
                        <AvatarFallback className="rounded-lg bg-accent text-accent-foreground">{initials(user.name)}</AvatarFallback>
                      </Avatar>
                      <div className="grid flex-1 text-left leading-tight">
                        <span className="truncate text-sm font-medium">{user.name}</span>
                        <span className="truncate text-xs text-muted-foreground">{user.email}</span>
                      </div>
                      <ChevronsUpDown className="ml-auto size-4" />
                    </SidebarMenuButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="top" align="start" className="w-56">
                    <DropdownMenuLabel className="font-normal">
                      <div className="text-sm font-medium">{user.name}</div>
                      <div className="text-xs text-muted-foreground">{user.role === "admin" ? "Администратор" : "Сотрудник"}</div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={logout}>
                      <LogOut />
                      Выйти
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
          <SidebarRail />
        </Sidebar>
        <SidebarInset className="h-svh overflow-hidden">{children}</SidebarInset>
      </SidebarProvider>
    </SWRConfig>
  )
}
