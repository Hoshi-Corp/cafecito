import { handle, json } from "@/server/http";
import { ratePlace } from "@/server/places";

export const PUT = (req: Request, ctx: RouteContext<"/api/groups/[id]/places/[placeId]/rating">) =>
  handle(ctx.params, async ({ db, groupId, meId }) => {
    const body = await json(req);
    const stars = typeof body === "object" && body !== null ? (body as { stars?: unknown }).stars : undefined;
    return ratePlace(db, groupId, meId, (await ctx.params).placeId, stars);
  }, "group");

export const DELETE = (_req: Request, ctx: RouteContext<"/api/groups/[id]/places/[placeId]/rating">) =>
  handle(ctx.params, async ({ db, groupId, meId }) => ratePlace(db, groupId, meId, (await ctx.params).placeId, null), "group");
