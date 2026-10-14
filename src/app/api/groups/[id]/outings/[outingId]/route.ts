import { handle } from "@/server/http";
import { deleteOuting } from "@/server/outings";
import { notifyDeleted } from "@/server/push";

export const DELETE = (_req: Request, ctx: RouteContext<"/api/groups/[id]/outings/[outingId]">) =>
  handle(
    ctx.params,
    async ({ db, groupId, meId }) => {
      // Not awaited, so a slow push service cannot delay the answer; deleteOuting runs first and throws before any push on a 403 or 404.
      void notifyDeleted(db, groupId, meId, deleteOuting(db, groupId, meId, (await ctx.params).outingId));
    },
    "group",
  );
