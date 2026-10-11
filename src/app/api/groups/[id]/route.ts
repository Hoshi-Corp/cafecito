import { handle, json } from "@/server/http";
import { loadGroup, updateGroup } from "@/server/groups";

export const GET = (_req: Request, ctx: RouteContext<"/api/groups/[id]">) =>
  handle(ctx.params, ({ db, groupId, meId }) => loadGroup(db, groupId, meId));

export const PATCH = (req: Request, ctx: RouteContext<"/api/groups/[id]">) =>
  handle(ctx.params, async ({ db, groupId, meId }) => updateGroup(db, groupId, meId, await json(req)), "group");
