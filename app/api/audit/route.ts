import { currentUser } from "@/lib/session";
import { db } from "@/lib/db";
export const dynamic = "force-dynamic";
const cell = (v: string) =>
  '"' + v.replace(/"/g, '""').replace(/^[=+@-]/, "'") + '"';
export async function GET() {
  const user = await currentUser();
  if (!user) return new Response(null, { status: 401 });
  if (user.role !== "owner") return new Response(null, { status: 403 });
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      controller.enqueue(
        enc.encode(
          "\uFEFFВремя,Пользователь,Логин,Действие,Запись,Подробности\n",
        ),
      );
      let cursor: string | undefined;
      try {
        while (true) {
          const rows = await db.auditLog.findMany({
            take: 500,
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            include: { user: { select: { name: true, email: true } } },
          });
          if (!rows.length) break;
          for (const a of rows)
            controller.enqueue(
              enc.encode(
                [
                  a.createdAt.toISOString(),
                  a.actorName || a.user.name,
                  a.user.email,
                  a.action,
                  a.entityId,
                  JSON.stringify(a.details),
                ]
                  .map(cell)
                  .join(",") + "\n",
              ),
            );
          cursor = rows.at(-1)!.id;
        }
        controller.close();
      } catch (e) {
        controller.error(e);
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=hotel-audit.csv",
      "Cache-Control": "private, no-store",
    },
  });
}
