import { z } from "zod";
export const id = z.string().min(1).max(100);
export const text = z.string().trim().max(2000);
export const money = z.number().int().min(0).max(100_000_000);
export const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v);
    return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === v;
  }, "Некорректная дата");
export const bookingSchema = z
  .object({
    id: id.optional(),
    version: z.number().int().positive().optional(),
    roomId: id,
    guestId: id,
    start: dateString,
    end: dateString,
    guestCount: z.number().int().min(1).max(100),
    linen: z.number().int().min(0).max(100),
    totalCents: money,
    prepaymentCents: money.default(0),
    method: z.enum(["cash", "card", "transfer", "other"]).default("transfer"),
    notes: text.default(""),
  })
  .refine((b) => b.end > b.start, "Выезд должен быть позже заезда")
  .refine(
    (b) => b.prepaymentCents <= b.totalCents,
    "Предоплата больше стоимости",
  );
export const guestSchema = z.object({
  id: id.optional(),
  name: z.string().trim().min(2).max(200),
  phone: z.string().trim().max(40).default(""),
  email: z.union([z.email(), z.literal("")]).default(""),
  notes: text.default(""),
});
export const roomSchema = z.object({
  id: id.optional(),
  name: z.string().trim().min(1).max(100),
  capacity: z.number().int().min(1).max(100),
  priceCents: money,
  status: z.enum(["ready", "cleaning", "maintenance"]),
});
export function overlaps(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
) {
  return aStart < bEnd && aEnd > bStart;
}
export function canTransition(from: string, to: string) {
  return (
    (from === "booked" && ["checked_in", "cancelled"].includes(to)) ||
    (from === "checked_in" && to === "completed")
  );
}
export function hotelToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.HOTEL_TIMEZONE || "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function requireAdmin(role: string) {
  if (!["owner", "admin"].includes(role))
    throw new Error("Эта операция доступна только администратору");
}

export function requireOwner(role: string) {
  if (role !== "owner")
    throw new Error("Эта операция доступна только владельцу");
}
