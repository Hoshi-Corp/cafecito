import { handle, json } from "@/server/http";
import { createPlace } from "@/server/places";

export const POST = (req: Request, ctx: RouteContext<"/api/groups/[id]/places">) =>
  handle(ctx.params, async ({ db, groupId, meId }) => createPlace(db, groupId, meId, await json(req)), "group");
