import { currentUser, sameOrigin } from "@/lib/session";
import { db } from "@/lib/db";
import { encrypt, fileType } from "@/lib/crypto";
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return Response.json({ error: "Недопустимый источник" }, { status: 403 });
  const user = await currentUser();
  if (!user)
    return Response.json({ error: "Войдите в систему" }, { status: 401 });
  if (user.role === "staff")
    return Response.json(
      { error: "Документы доступны только администратору" },
      { status: 403 },
    );
  if (Number(request.headers.get("content-length") || 0) > 6 * 1024 * 1024)
    return Response.json({ error: "Максимум 5 МБ" }, { status: 413 });
  try {
    const form = await request.formData();
    const file = form.get("file"),
      guestId = form.get("guestId");
    if (
      !(file instanceof File) ||
      typeof guestId !== "string" ||
      file.size > 5 * 1024 * 1024 ||
      file.size === 0
    )
      return Response.json(
        { error: "Выберите PDF, JPEG или PNG размером до 5 МБ" },
        { status: 400 },
      );
    const bytes = Buffer.from(await file.arrayBuffer()),
      mime = fileType(bytes);
    if (!mime)
      return Response.json(
        { error: "Разрешены только PDF, JPEG и PNG" },
        { status: 400 },
      );
    const secured = encrypt(bytes);
    const doc = await db.$transaction(async (tx) => {
      const doc = await tx.document.create({
        data: {
          guestId,
          name: file.name.replace(/[\r\n\x00-\x1f/\\]/g, "_").slice(0, 200),
          mime,
          ...secured,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          actorName: user.name,
          actorRole: user.role,
          action: "document.upload",
          entityId: doc.id,
        },
      });
      return doc;
    });
    return Response.json({ id: doc.id });
  } catch {
    return Response.json(
      {
        error:
          "Не удалось сохранить документ. Проверьте гостя и ключ шифрования.",
      },
      { status: 400 },
    );
  }
}
