import type { Metadata } from "next"
import { Inter, JetBrains_Mono } from "next/font/google"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import "./globals.css"

const sans = Inter({ variable: "--font-sans", subsets: ["latin", "cyrillic"] })
const mono = JetBrains_Mono({ variable: "--font-mono", subsets: ["latin", "cyrillic"] })

export const metadata: Metadata = {
  title: { default: "Единое окно заявок", template: "%s · Единое окно" },
  description: "Все обращения в фонд из почты, соцсетей, мессенджеров и сайта — в одном месте",
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ru" className={`dark ${sans.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
        <Toaster position="top-right" richColors theme="dark" />
      </body>
    </html>
  )
}
