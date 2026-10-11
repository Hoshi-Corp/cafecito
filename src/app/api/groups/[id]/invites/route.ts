import { handle, json } from "@/server/http";
import { createInvite, listInvites } from "@/server/groups";

export const GET = (_req: Request, ctx: RouteContext<"/api/groups/[id]/invites">) =>
  handle(ctx.params, ({ db, groupId, meId }) => listInvites(db, groupId, meId));

export const POST = (req: Request, ctx: RouteContext<"/api/groups/[id]/invites">) =>
  handle(ctx.params, async ({ db, groupId, meId }) => createInvite(db, groupId, meId, await json(req)));
