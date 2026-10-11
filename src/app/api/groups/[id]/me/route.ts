import { cookies } from "next/headers";
import { handle, json, SESSION_COOKIE } from "@/server/http";
import { updateMe } from "@/server/groups";
import { deleteMe, exportMe } from "@/server/account";

/** Everything stored about me, as a file to keep. */
export const GET = (_req: Request, ctx: RouteContext<"/api/groups/[id]/me">) =>
  handle(ctx.params, ({ db, meId }) =>
    Response.json(exportMe(db, meId), {
      headers: { "content-disposition": `attachment; filename="cafecito-my-data.json"` },
    }),
  );

export const PATCH = (req: Request, ctx: RouteContext<"/api/groups/[id]/me">) =>
  handle(ctx.params, async ({ db, meId }) => updateMe(db, meId, await json(req)), "member");

/** Deletes my account and data; this device is signed out. */
export const DELETE = (_req: Request, ctx: RouteContext<"/api/groups/[id]/me">) =>
  handle(
    ctx.params,
    async ({ db, groupId, meId }) => {
      deleteMe(db, groupId, meId);
      (await cookies()).delete(SESSION_COOKIE);
    },
    "group",
  );
