import { handle, json } from "@/server/http";
import { clearRating, ratePlace } from "@/server/places";

export const PUT = (req: Request, ctx: RouteContext<"/api/groups/[id]/places/[placeId]/rating">) =>
  handle(ctx.params, async ({ db, groupId, meId }) => ratePlace(db, groupId, meId, (await ctx.params).placeId, await json(req)), "group");

export const DELETE = (_req: Request, ctx: RouteContext<"/api/groups/[id]/places/[placeId]/rating">) =>
  handle(ctx.params, async ({ db, groupId, meId }) => clearRating(db, groupId, meId, (await ctx.params).placeId), "group");
