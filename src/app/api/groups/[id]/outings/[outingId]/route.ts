import { handle } from "@/server/http";
import { deleteOuting } from "@/server/outings";
import { notifyDeleted } from "@/server/push";

export const DELETE = (_req: Request, ctx: RouteContext<"/api/groups/[id]/outings/[outingId]">) =>
  handle(
    ctx.params,
    async ({ db, groupId, meId }) => {
      // Throws on a 403 or 404, before any push is started.
      const yes = deleteOuting(db, groupId, meId, (await ctx.params).outingId);
      void notifyDeleted(db, groupId, meId, yes); // not awaited, so a slow push service cannot delay the answer
    },
    "group",
  );
