import { handle, json } from "@/server/http";
import { updateMe } from "@/server/groups";

export const PATCH = (req: Request, ctx: RouteContext<"/api/groups/[id]/me">) =>
  handle(ctx.params, async ({ db, meId }) => updateMe(db, meId, await json(req)), "member");
