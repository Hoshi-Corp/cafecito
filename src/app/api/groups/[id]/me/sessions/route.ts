import { handle } from "@/server/http";
import { listSessions, signOutOthers } from "@/server/account";

export const GET = (_req: Request, ctx: RouteContext<"/api/groups/[id]/me/sessions">) =>
  handle(ctx.params, ({ db, meId, tokenHash }) => listSessions(db, meId, tokenHash));

/** Signs out every other device. */
export const DELETE = (_req: Request, ctx: RouteContext<"/api/groups/[id]/me/sessions">) =>
  handle(ctx.params, ({ db, groupId, meId, tokenHash }) => signOutOthers(db, groupId, meId, tokenHash));
