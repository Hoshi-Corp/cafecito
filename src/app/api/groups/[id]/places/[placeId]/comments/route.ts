import { handle, json } from "@/server/http";
import { addComment } from "@/server/places";

export const POST = (req: Request, ctx: RouteContext<"/api/groups/[id]/places/[placeId]/comments">) =>
  handle(ctx.params, async ({ db, groupId, meId }) => addComment(db, groupId, meId, (await ctx.params).placeId, await json(req)), "group");
