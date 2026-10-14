import { handle, json } from "@/server/http";
import { answerOuting } from "@/server/outings";

export const PUT = (req: Request, ctx: RouteContext<"/api/groups/[id]/outings/[outingId]/rsvp">) =>
  handle(ctx.params, async ({ db, groupId, meId }) => answerOuting(db, groupId, meId, (await ctx.params).outingId, await json(req)), "group");
