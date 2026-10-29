import { desc, ilike, or, sql } from "drizzle-orm"
import { db, t } from "@/db"
import { api } from "@/lib/auth"

/** Люди, которые обращались в фонд: способы связи и число обращений. */
export const GET = api(async (req) => {
  const q = new URL(req.url).searchParams.get("q")?.trim()
  const like = q ? `%${q.replace(/[%_]/g, "\\$&")}%` : null
  const rows = await db
    .select({
      id: t.contacts.id,
      name: t.contacts.name,
      email: t.contacts.email,
      phone: t.contacts.phone,
      createdAt: t.contacts.createdAt,
      // В подзапросах таблицы с явными псевдонимами: drizzle в списке выборки пишет колонки без таблицы.
      requests: sql<number>`(select count(*) from requests r where r.contact_id = "contacts"."id")`.mapWith(Number),
      lastRequestId: sql<string | null>`(select r.id from requests r where r.contact_id = "contacts"."id" order by r.last_message_at desc limit 1)`,
      lastAt: sql<string | null>`(select max(r.last_message_at) from requests r where r.contact_id = "contacts"."id")`,
      applications: sql<number>`(select count(*) from applications a where a.contact_id = "contacts"."id")`.mapWith(Number),
      kinds: sql<string[]>`(select coalesce(array_agg(distinct c.kind), '{}') from contact_identities ci join channels c on c.id = ci.channel_id where ci.contact_id = "contacts"."id")`,
    })
    .from(t.contacts)
    .where(like ? or(ilike(t.contacts.name, like), ilike(t.contacts.email, like), ilike(t.contacts.phone, like)) : undefined)
    .orderBy(desc(sql`coalesce((select max(r.last_message_at) from requests r where r.contact_id = "contacts"."id"), "contacts"."created_at")`))
    .limit(200)
  return { contacts: rows }
})
