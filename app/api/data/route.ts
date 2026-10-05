import { currentUser } from "@/lib/session";
import { db } from "@/lib/db";
import { hotelToday } from "@/lib/domain";
export const dynamic = "force-dynamic";
export async function GET() {
  const user = await currentUser();
  if (!user)
    return Response.json({ error: "Войдите в систему" }, { status: 401 });
  const [rooms, guests, bookings, cleaning, audit, users] = await Promise.all([
    db.room.findMany({ orderBy: { name: "asc" } }),
    db.guest.findMany({
      orderBy: { name: "asc" },
      include: {
        documents: { select: { id: true, name: true, createdAt: true } },
      },
    }),
    db.booking.findMany({
      orderBy: { start: "desc" },
      include: { payments: { orderBy: { createdAt: "desc" } } },
    }),
    db.cleaningTask.findMany({
      where: { done: false },
      orderBy: { createdAt: "asc" },
    }),
    user.role === "owner"
      ? db.auditLog.findMany({
          take: 200,
          orderBy: { createdAt: "desc" },
          include: { user: { select: { name: true } } },
        })
      : [],
    user.role === "owner"
      ? db.user.findMany({
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            active: true,
          },
          orderBy: { name: "asc" },
        })
      : [],
  ]);
  return Response.json(
    {
      rooms,
      guests: guests.map((g) => ({
        ...g,
        documents: user.role !== "staff" ? g.documents : [],
      })),
      bookings,
      cleaning,
      audit,
      users,
      today: hotelToday(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
