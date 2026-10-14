import { handle, json } from "@/server/http";
import { createOuting } from "@/server/outings";
import { notifyProposed } from "@/server/push";

export const POST = (req: Request, ctx: RouteContext<"/api/groups/[id]/outings">) =>
  handle(
    ctx.params,
    async ({ db, groupId, meId }) => {
      const outing = createOuting(db, groupId, meId, await json(req));
      void notifyProposed(db, groupId, meId); // in the background: a slow push service must not slow the answer
      return outing;
    },
    "group",
  );
