import { handle } from "@/server/http";
import { revokeInvite } from "@/server/groups";

export const DELETE = (_req: Request, ctx: RouteContext<"/api/groups/[id]/invites/[inviteId]">) =>
  handle(ctx.params, async ({ db, groupId, meId }) => revokeInvite(db, groupId, meId, (await ctx.params).inviteId));
