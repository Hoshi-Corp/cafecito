import { handle } from "@/server/http";
import { deleteComment } from "@/server/places";

export const DELETE = (_req: Request, ctx: RouteContext<"/api/groups/[id]/places/[placeId]/comments/[commentId]">) =>
  handle(ctx.params, async ({ db, groupId, meId }) => {
    const { placeId, commentId } = await ctx.params;
    return deleteComment(db, groupId, meId, placeId, commentId);
  }, "group");
