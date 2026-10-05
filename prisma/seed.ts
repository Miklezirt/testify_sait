import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";
import { hotelToday } from "../lib/domain";
const db = new PrismaClient();
async function main() {
  const accounts = [
    {
      role: "owner" as const,
      name: "Владелец",
      email: process.env.SEED_OWNER_EMAIL,
      password: process.env.SEED_OWNER_PASSWORD,
    },
    {
      role: "admin" as const,
      name: "Администратор",
      email: process.env.SEED_ADMIN_EMAIL,
      password: process.env.SEED_ADMIN_PASSWORD,
    },
    {
      role: "staff" as const,
      name: "Сотрудник",
      email: process.env.SEED_STAFF_EMAIL,
      password: process.env.SEED_STAFF_PASSWORD,
    },
  ];
  for (const a of accounts) {
    if (!a.email) throw Error(`Укажите SEED_${a.role.toUpperCase()}_EMAIL`);
    const email = a.email.toLowerCase();
    if (await db.user.findUnique({ where: { email } })) continue;
    if (!a.password || a.password.length < 12)
      throw Error(`SEED_${a.role.toUpperCase()}_PASSWORD: минимум 12 символов`);
    await db.user.create({
      data: {
        name: a.name,
        email,
        passwordHash: await hash(a.password, 12),
        role: a.role,
      },
    });
  }
  if (process.env.SEED_DEMO !== "true") return;
  // Stable IDs make re-running demo seed non-destructive and idempotent.
  const rooms = [
    { id: "demo-room-11", name: "№11", capacity: 2, priceCents: 350000 },
    { id: "demo-room-12", name: "№12", capacity: 2, priceCents: 350000 },
    {
      id: "demo-room-attic",
      name: "Мансарда",
      capacity: 3,
      priceCents: 450000,
    },
    { id: "demo-room-14", name: "№14", capacity: 4, priceCents: 600000 },
  ];
  for (const r of rooms)
    await db.room.upsert({ where: { id: r.id }, update: {}, create: r });
  const today = hotelToday(),
    offset = (n: number) => new Date(new Date(today).getTime() + n * 86400000);
  const guests = [
    "Демо Иванов Иван",
    "Демо Петров Алексей",
    "Демо Сидорова Анна",
    "Демо Орлов Михаил",
  ];
  for (let i = 0; i < guests.length; i++)
    await db.guest.upsert({
      where: { id: `demo-guest-${i}` },
      update: {},
      create: {
        id: `demo-guest-${i}`,
        name: guests[i],
        notes: "Вымышленный гость для демонстрации",
      },
    });
  const demo = [
    {
      id: "demo-booking-0",
      roomId: rooms[0].id,
      guestId: "demo-guest-0",
      start: offset(0),
      end: offset(3),
      status: "checked_in" as const,
      guestCount: 2,
      totalCents: 1050000,
      checkedInAt: new Date(),
    },
    {
      id: "demo-booking-1",
      roomId: rooms[1].id,
      guestId: "demo-guest-1",
      start: offset(1),
      end: offset(4),
      status: "booked" as const,
      guestCount: 2,
      totalCents: 1050000,
    },
    {
      id: "demo-booking-2",
      roomId: rooms[3].id,
      guestId: "demo-guest-3",
      start: offset(0),
      end: offset(2),
      status: "booked" as const,
      guestCount: 4,
      totalCents: 1200000,
    },
    {
      id: "demo-booking-3",
      roomId: rooms[2].id,
      guestId: "demo-guest-2",
      start: offset(-3),
      end: offset(0),
      status: "completed" as const,
      guestCount: 3,
      totalCents: 1350000,
      checkedOutAt: new Date(),
    },
  ];
  for (const b of demo)
    await db.booking.upsert({ where: { id: b.id }, update: {}, create: b });
  await db.payment.upsert({
    where: { id: "demo-prepayment" },
    update: {},
    create: {
      id: "demo-prepayment",
      bookingId: "demo-booking-0",
      amountCents: 500000,
      method: "transfer",
      kind: "prepayment",
    },
  });
  if (
    !(await db.cleaningTask.findUnique({
      where: { bookingId: "demo-booking-3" },
    }))
  ) {
    await db.$transaction([
      db.room.update({
        where: { id: rooms[2].id },
        data: { status: "cleaning" },
      }),
      db.cleaningTask.create({
        data: { bookingId: "demo-booking-3", roomId: rooms[2].id },
      }),
    ]);
  }
  console.log(
    "Демо: 4 номера, 4 вымышленных гостя и брони. Пароли не выводятся.",
  );
}
main().finally(() => db.$disconnect());
