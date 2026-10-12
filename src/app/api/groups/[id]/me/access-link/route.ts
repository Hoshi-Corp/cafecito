import { handle } from "@/server/http";
import { newAccessToken } from "@/server/groups";

/** Replaces my personal sign-in link; the new one is returned once. */
export const POST = (_req: Request, ctx: RouteContext<"/api/groups/[id]/me/access-link">) =>
  handle(ctx.params, ({ db, meId }) => ({ accessToken: newAccessToken(db, meId) }));
