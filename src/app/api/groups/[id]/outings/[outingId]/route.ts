import { handle } from "@/server/http";
import { deleteOuting } from "@/server/outings";

export const DELETE = (_req: Request, ctx: RouteContext<"/api/groups/[id]/outings/[outingId]">) =>
  handle(ctx.params, async ({ db, groupId, meId }) => deleteOuting(db, groupId, meId, (await ctx.params).outingId), "group");
