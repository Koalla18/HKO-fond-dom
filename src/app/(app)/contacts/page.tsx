import type { Metadata } from "next"
import { ContactsView } from "@/components/dashboard/contacts-view"

export const metadata: Metadata = { title: "Люди" }

export default function ContactsPage() {
  return <ContactsView />
}
