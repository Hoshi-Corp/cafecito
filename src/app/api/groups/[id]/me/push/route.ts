import { handle, json } from "@/server/http";
import { pushState, subscribePush, unsubscribePush } from "@/server/push";

/** The server's public push key, and whether this device has notifications on. */
export const GET = (_req: Request, ctx: RouteContext<"/api/groups/[id]/me/push">) =>
  handle(ctx.params, ({ db, tokenHash }) => pushState(db, tokenHash));

/** Turns notifications on for this device with the browser's push subscription. */
export const PUT = (req: Request, ctx: RouteContext<"/api/groups/[id]/me/push">) =>
  handle(ctx.params, async ({ db, meId, tokenHash }) => subscribePush(db, meId, tokenHash, await json(req)));

/** Turns notifications off for this device. */
export const DELETE = (_req: Request, ctx: RouteContext<"/api/groups/[id]/me/push">) =>
  handle(ctx.params, ({ db, tokenHash }) => unsubscribePush(db, tokenHash));
