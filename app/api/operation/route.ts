import { currentUser, sameOrigin } from "@/lib/session";
import { db } from "@/lib/db";
import { operate, operationError } from "@/lib/operations";
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return Response.json(
      { error: "Недопустимый источник запроса" },
      { status: 403 },
    );
  const user = await currentUser();
  if (!user)
    return Response.json({ error: "Войдите в систему" }, { status: 401 });
  if (Number(request.headers.get("content-length") || 0) > 32000)
    return Response.json({ error: "Запрос слишком большой" }, { status: 413 });
  let op = "unknown";
  try {
    const input = await request.json();
    op = typeof input.op === "string" ? input.op.slice(0, 80) : "unknown";
    const data = input.data;
    const id = await operate(user, op, data);
    return Response.json({ id });
  } catch (e) {
    const error = operationError(e);
    await db.auditLog
      .create({
        data: {
          userId: user.id,
          actorName: user.name,
          actorRole: user.role,
          action: "operation.failed",
          entityId: op,
          details: { status: error.status },
        },
      })
      .catch(() => {});
    return Response.json({ error: error.message }, { status: error.status });
  }
}
