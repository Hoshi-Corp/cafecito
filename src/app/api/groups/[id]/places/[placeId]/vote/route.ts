import { handle } from "@/server/http";
import { votePlace } from "@/server/places";

export const PUT = (_req: Request, ctx: RouteContext<"/api/groups/[id]/places/[placeId]/vote">) =>
  handle(ctx.params, async ({ db, groupId, meId }) => votePlace(db, groupId, meId, (await ctx.params).placeId, true), "group");

export const DELETE = (_req: Request, ctx: RouteContext<"/api/groups/[id]/places/[placeId]/vote">) =>
  handle(ctx.params, async ({ db, groupId, meId }) => votePlace(db, groupId, meId, (await ctx.params).placeId, false), "group");
