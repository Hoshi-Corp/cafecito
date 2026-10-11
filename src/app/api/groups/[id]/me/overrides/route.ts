import { handle, json } from "@/server/http";
import { patchOverrides } from "@/server/groups";

export const PATCH = (req: Request, ctx: RouteContext<"/api/groups/[id]/me/overrides">) =>
  handle(ctx.params, async ({ db, meId }) => patchOverrides(db, meId, await json(req)));
