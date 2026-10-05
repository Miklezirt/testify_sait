import { currentUser, sameOrigin } from "@/lib/session";
import { db } from "@/lib/db";
export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  const user = await currentUser();
  if (user)
    await db.auditLog.create({
      data: {
        userId: user.id,
        actorName: user.name,
        actorRole: user.role,
        action: "auth.logout",
        entityId: user.id,
      },
    });
  return Response.json({ ok: true });
}
