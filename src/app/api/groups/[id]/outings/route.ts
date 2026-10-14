import { handle, json } from "@/server/http";
import { createOuting } from "@/server/outings";

export const POST = (req: Request, ctx: RouteContext<"/api/groups/[id]/outings">) =>
  handle(ctx.params, async ({ db, groupId, meId }) => createOuting(db, groupId, meId, await json(req)), "group");
