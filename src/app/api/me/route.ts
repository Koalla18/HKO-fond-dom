import { api } from "@/lib/auth"
import { getSetting } from "@/lib/settings"

export const GET = api(async (_req, _ctx, user) => ({ user, org: await getSetting("org"), ai: await getSetting("ai") }))
