import { currentUser, sameOrigin } from "@/lib/session";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
async function allowed() {
  const user = await currentUser();
  if (!user)
    return {
      response: Response.json({ error: "Войдите в систему" }, { status: 401 }),
    };
  if (user.role === "staff")
    return {
      response: Response.json({ error: "Недостаточно прав" }, { status: 403 }),
    };
  return { user };
}
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await allowed();
  if (result.response) return result.response;
  const { id } = await params;
  const doc = await db.document.findUnique({ where: { id } });
  if (!doc)
    return Response.json({ error: "Документ не найден" }, { status: 404 });
  try {
    const data = decrypt(doc);
    await db.auditLog.create({
      data: {
        userId: result.user!.id,
        actorName: result.user!.name,
        actorRole: result.user!.role,
        action: "document.download",
        entityId: id,
      },
    });
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": doc.mime,
        "Content-Disposition": `attachment; filename="document"; filename*=UTF-8''${encodeURIComponent(doc.name)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: "Документ недоступен" }, { status: 500 });
  }
}
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!sameOrigin(request))
    return Response.json({ error: "Недопустимый источник" }, { status: 403 });
  const result = await allowed();
  if (result.response) return result.response;
  const { id } = await params;
  await db.$transaction(async (tx) => {
    await tx.document.deleteMany({ where: { id } });
    await tx.auditLog.create({
      data: {
        userId: result.user!.id,
        actorName: result.user!.name,
        actorRole: result.user!.role,
        action: "document.delete",
        entityId: id,
      },
    });
  });
  return Response.json({ ok: true });
}
