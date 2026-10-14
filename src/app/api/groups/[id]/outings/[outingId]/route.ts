import { handle } from "@/server/http";
import { deleteOuting } from "@/server/outings";
import { notifyDeleted } from "@/server/push";

export const DELETE = (_req: Request, ctx: RouteContext<"/api/groups/[id]/outings/[outingId]">) =>
  handle(
    ctx.params,
    async ({ db, groupId, meId }) => {
      void notifyDeleted(db, meId, deleteOuting(db, groupId, meId, (await ctx.params).outingId));
    },
    "group",
  );
