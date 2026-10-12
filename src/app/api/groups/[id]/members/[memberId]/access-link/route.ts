import { handle } from "@/server/http";
import { reissueAccessToken } from "@/server/groups";

/** Owner only: replaces a member's personal sign-in link; the new one is returned once. */
export const POST = (_req: Request, ctx: RouteContext<"/api/groups/[id]/members/[memberId]/access-link">) =>
  handle(ctx.params, async ({ db, groupId, meId }) => ({
    accessToken: reissueAccessToken(db, groupId, meId, (await ctx.params).memberId),
  }));
