import { handle, json } from "@/server/http";
import { deletePlace, updatePlace } from "@/server/places";

export const PATCH = (req: Request, ctx: RouteContext<"/api/groups/[id]/places/[placeId]">) =>
  handle(ctx.params, async ({ db, groupId, meId }) => updatePlace(db, groupId, meId, (await ctx.params).placeId, await json(req)), "group");

export const DELETE = (_req: Request, ctx: RouteContext<"/api/groups/[id]/places/[placeId]">) =>
  handle(ctx.params, async ({ db, groupId, meId }) => deletePlace(db, groupId, meId, (await ctx.params).placeId), "group");
