import { handle } from "@/server/http";
import { removeMember } from "@/server/groups";

export const DELETE = (_req: Request, ctx: RouteContext<"/api/groups/[id]/members/[memberId]">) =>
  handle(
    ctx.params,
    async ({ db, groupId, meId }) => removeMember(db, groupId, meId, (await ctx.params).memberId),
    "group",
  );
