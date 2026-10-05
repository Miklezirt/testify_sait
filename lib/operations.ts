import { Prisma, Role } from "@prisma/client";
import { hash } from "bcryptjs";
import { z } from "zod";
import { db } from "./db";
import {
  bookingSchema,
  guestSchema,
  roomSchema,
  id,
  money,
  text,
  requireAdmin,
  canTransition,
  hotelToday,
  requireOwner,
} from "./domain";
type Actor = { id: string; role: Role; sessionVersion?: number };
export class Conflict extends Error {}
export async function operate(actor: Actor, op: string, raw: unknown) {
  return db.$transaction(
    async (tx) => {
      // Serialize hotel mutations across app instances; DB exclusion is an additional guarantee.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(7162401)`;
      const actual = await tx.user.findUniqueOrThrow({
        where: { id: actor.id },
      });
      if (
        !actual.active ||
        (actor.sessionVersion !== undefined &&
          actor.sessionVersion !== actual.sessionVersion)
      )
        throw new Conflict("Сеанс завершён. Войдите снова.");
      actor = { id: actual.id, role: actual.role };
      const audit = async (
        action: string,
        entityId: string,
        details: Prisma.InputJsonValue = {},
      ) => {
        await tx.auditLog.create({
          data: {
            userId: actor.id,
            actorName: actual.name,
            actorRole: actual.role,
            action,
            entityId,
            details,
          },
        });
      };
      if (op === "guest") {
        const { id: guestId, ...data } = guestSchema.parse(raw);
        const guest = guestId
          ? await tx.guest.update({ where: { id: guestId }, data })
          : await tx.guest.create({ data });
        await audit(guestId ? "guest.update" : "guest.create", guest.id, {
          fields: Object.keys(data),
        });
        return guest.id;
      }
      if (op === "room") {
        requireAdmin(actor.role);
        const { id: roomId, ...data } = roomSchema.parse(raw);
        if (roomId) {
          const bookings = await tx.booking.findMany({
            where: {
              roomId,
              OR: [
                { status: "checked_in" },
                { status: "booked", end: { gt: new Date(hotelToday()) } },
              ],
            },
          });
          if (bookings.some((b) => b.guestCount > data.capacity))
            throw new Conflict(
              "Вместимость меньше числа гостей в действующей брони",
            );
          if (
            data.status !== "ready" &&
            bookings.some((b) => b.status === "checked_in")
          )
            throw new Conflict("В номере живут гости");
          if (data.status === "maintenance" && bookings.length)
            throw new Conflict("Сначала перенесите или отмените будущие брони");
          if (
            data.status === "ready" &&
            (await tx.cleaningTask.count({ where: { roomId, done: false } }))
          )
            throw new Conflict("Сначала завершите уборку");
        }
        const room = roomId
          ? await tx.room.update({ where: { id: roomId }, data })
          : await tx.room.create({ data });
        if (
          data.status === "cleaning" &&
          !(await tx.cleaningTask.count({
            where: { roomId: room.id, done: false },
          }))
        )
          await tx.cleaningTask.create({ data: { roomId: room.id } });
        await audit(roomId ? "room.update" : "room.create", room.id, data);
        return room.id;
      }
      if (op === "booking") {
        const b = bookingSchema.parse(raw);
        const room = await tx.room.findUniqueOrThrow({
          where: { id: b.roomId },
        });
        if (room.status === "maintenance")
          throw new Conflict("Номер на обслуживании");
        if (b.guestCount > room.capacity)
          throw new Conflict("Число гостей превышает вместимость номера");
        await tx.guest.findUniqueOrThrow({ where: { id: b.guestId } });
        const existing = b.id
          ? await tx.booking.findUniqueOrThrow({
              where: { id: b.id },
              include: { payments: true },
            })
          : null;
        if (
          existing &&
          (!["booked", "checked_in"].includes(existing.status) ||
            existing.version !== b.version)
        )
          throw new Conflict(
            "Бронь уже изменена или не подлежит редактированию. Обновите страницу.",
          );
        if (
          b.start < hotelToday() &&
          !(
            existing?.status === "checked_in" &&
            b.start === existing.start.toISOString().slice(0, 10)
          )
        )
          throw new Conflict("Нельзя создавать или переносить бронь в прошлое");
        if (
          existing?.status === "checked_in" &&
          (b.roomId !== existing.roomId ||
            b.guestId !== existing.guestId ||
            b.start !== existing.start.toISOString().slice(0, 10) ||
            b.end <= hotelToday())
        )
          throw new Conflict(
            "Для проживающего гостя можно изменить дату выезда, стоимость и детали, сохранив номер, гостя и дату заезда",
          );
        const paid =
          existing?.payments.reduce((s, p) => s + p.amountCents, 0) ?? 0;
        if (paid > b.totalCents)
          throw new Conflict(
            "Стоимость ниже оплаченной суммы. Сначала оформите возврат.",
          );
        if (existing && b.prepaymentCents)
          throw new Conflict("Дополнительную оплату внесите отдельно");
        const overlap = await tx.booking.findFirst({
          where: {
            roomId: b.roomId,
            status: { not: "cancelled" },
            id: { not: b.id ?? "" },
            start: { lt: new Date(b.end) },
            end: { gt: new Date(b.start) },
          },
        });
        if (overlap) throw new Conflict("Номер уже занят в выбранные даты");
        const data = {
          roomId: b.roomId,
          guestId: b.guestId,
          start: new Date(b.start),
          end: new Date(b.end),
          guestCount: b.guestCount,
          linen: b.linen,
          totalCents: b.totalCents,
          notes: b.notes,
        };
        const booking = existing
          ? await tx.booking.update({
              where: { id: existing.id },
              data: { ...data, version: { increment: 1 } },
            })
          : await tx.booking.create({ data });
        if (b.prepaymentCents)
          await tx.payment.create({
            data: {
              bookingId: booking.id,
              amountCents: b.prepaymentCents,
              method: b.method,
              kind: "prepayment",
            },
          });
        await audit(
          existing ? "booking.update" : "booking.create",
          booking.id,
          {
            before: existing
              ? {
                  roomId: existing.roomId,
                  guestId: existing.guestId,
                  start: existing.start.toISOString(),
                  end: existing.end.toISOString(),
                  totalCents: existing.totalCents,
                  guestCount: existing.guestCount,
                  linen: existing.linen,
                }
              : null,
            after: { ...data, start: b.start, end: b.end },
            prepaymentCents: b.prepaymentCents,
            method: b.method,
          },
        );
        return booking.id;
      }
      if (op === "status") {
        const b = z
          .object({
            id,
            version: z.number().int(),
            status: z.enum(["checked_in", "completed", "cancelled"]),
          })
          .parse(raw);
        const booking = await tx.booking.findUniqueOrThrow({
          where: { id: b.id },
          include: { room: true },
        });
        if (
          booking.version !== b.version ||
          !canTransition(booking.status, b.status)
        )
          throw new Conflict(
            "Недопустимый переход статуса или бронь уже изменена",
          );
        const today = hotelToday();
        const start = booking.start.toISOString().slice(0, 10),
          end = booking.end.toISOString().slice(0, 10);
        if (b.status === "checked_in") {
          if (today < start || today >= end)
            throw new Conflict(
              "Заезд возможен только в даты проживания. Измените даты брони.",
            );
          if (booking.room.status !== "ready")
            throw new Conflict("Номер ещё не готов к заезду");
          if (
            await tx.booking.count({
              where: { roomId: booking.roomId, status: "checked_in" },
            })
          )
            throw new Conflict("В номере уже живут гости");
        }
        // Early departure frees unused nights; a same-day stay still reserves one night.
        const checkoutEnd =
          b.status === "completed"
            ? new Date(
                Math.max(
                  new Date(today).getTime(),
                  booking.start.getTime() + 86400000,
                ),
              )
            : undefined;
        await tx.booking.update({
          where: { id: b.id },
          data: {
            status: b.status,
            version: { increment: 1 },
            ...(b.status === "checked_in" ? { checkedInAt: new Date() } : {}),
            ...(b.status === "completed"
              ? {
                  checkedOutAt: new Date(),
                  end:
                    checkoutEnd && checkoutEnd < booking.end
                      ? checkoutEnd
                      : booking.end,
                }
              : {}),
          },
        });
        if (b.status === "completed") {
          await tx.room.update({
            where: { id: booking.roomId },
            data: { status: "cleaning" },
          });
          await tx.cleaningTask.create({
            data: { roomId: booking.roomId, bookingId: b.id },
          });
        }
        await audit("booking." + b.status, b.id, {
          from: booking.status,
          to: b.status,
          roomId: booking.roomId,
          end: checkoutEnd?.toISOString() ?? booking.end.toISOString(),
        });
        return b.id;
      }
      if (op === "payment") {
        const p = z
          .object({
            bookingId: id,
            amountCents: money.refine((n) => n > 0),
            method: z.enum(["cash", "card", "transfer", "other"]),
            refund: z.boolean().default(false),
            note: text.default(""),
          })
          .parse(raw);
        const b = await tx.booking.findUniqueOrThrow({
          where: { id: p.bookingId },
          include: { payments: true },
        });
        const paid = b.payments.reduce((s, p) => s + p.amountCents, 0);
        if (p.refund) {
          requireOwner(actor.role);
          if (p.amountCents > paid)
            throw new Conflict("Возврат больше оплаченной суммы");
        } else {
          if (b.status === "cancelled")
            throw new Conflict("Отменённая бронь принимает только возвраты");
          if (paid + p.amountCents > b.totalCents)
            throw new Conflict("Сумма больше остатка к оплате");
        }
        const payment = await tx.payment.create({
          data: {
            bookingId: b.id,
            amountCents: p.refund ? -p.amountCents : p.amountCents,
            method: p.method,
            kind: p.refund ? "refund" : "payment",
            note: p.note,
          },
        });
        await tx.booking.update({
          where: { id: b.id },
          data: { version: { increment: 1 } },
        });
        await audit(
          p.refund ? "payment.refund" : "payment.create",
          payment.id,
          {
            bookingId: b.id,
            amountCents: payment.amountCents,
            method: p.method,
          },
        );
        return payment.id;
      }
      if (op === "clean") {
        const { id: taskId } = z.object({ id }).parse(raw);
        const task = await tx.cleaningTask.findUniqueOrThrow({
          where: { id: taskId },
        });
        if (task.done) throw new Conflict("Уборка уже завершена");
        await tx.cleaningTask.update({
          where: { id: taskId },
          data: { done: true, completedAt: new Date() },
        });
        if (
          !(await tx.cleaningTask.count({
            where: { roomId: task.roomId, done: false },
          }))
        )
          await tx.room.updateMany({
            where: { id: task.roomId, status: "cleaning" },
            data: { status: "ready" },
          });
        await audit("cleaning.complete", task.id);
        return task.id;
      }
      if (op === "user") {
        requireOwner(actor.role);
        const u = z
          .object({
            id: id.optional(),
            name: z.string().trim().min(2).max(100),
            email: z
              .email()
              .max(254)
              .transform((s) => s.toLowerCase()),
            role: z.enum(["owner", "admin", "staff"]),
            active: z.boolean(),
            password: z.string().max(128).default(""),
          })
          .parse(raw);
        if (u.id === actor.id && (!u.active || u.role !== "owner"))
          throw new Conflict(
            "Нельзя отключить себя или снять свою роль владельца",
          );
        if ((!u.id || u.password) && u.password.length < 12)
          throw new Conflict("Пароль должен содержать минимум 12 символов");
        const previous = u.id
          ? await tx.user.findUniqueOrThrow({ where: { id: u.id } })
          : null;
        const revoke =
          !!u.password ||
          (!!previous &&
            (previous.role !== u.role || previous.active !== u.active));
        const data = {
          name: u.name,
          email: u.email,
          role: u.role,
          active: u.active,
          ...(u.password
            ? {
                passwordHash: await hash(u.password, 12),
              }
            : {}),
          ...(revoke ? { sessionVersion: { increment: 1 } } : {}),
        };
        const user = u.id
          ? await tx.user.update({ where: { id: u.id }, data })
          : await tx.user.create({
              data: {
                name: u.name,
                email: u.email,
                role: u.role,
                active: u.active,
                passwordHash: data.passwordHash!,
              },
            });
        await audit(u.id ? "user.update" : "user.create", user.id, {
          name: u.name,
          email: u.email,
          role: u.role,
          active: u.active,
          passwordChanged: !!u.password,
        });
        return user.id;
      }
      throw new Error("Неизвестная операция");
    },
    { maxWait: 10000, timeout: 20000 },
  );
}
export function operationError(error: unknown) {
  if (error instanceof z.ZodError)
    return {
      message: error.issues.map((i) => i.message).join("; "),
      status: 400,
    };
  if (error instanceof Conflict) return { message: error.message, status: 409 };
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002")
      return { message: "Такая запись уже существует", status: 409 };
    if (error.code === "P2025")
      return { message: "Запись не найдена", status: 404 };
    if (error.code === "P2004" || error.code === "P2034")
      return {
        message: "Конфликт бронирования. Обновите данные и повторите.",
        status: 409,
      };
  }
  if (
    error instanceof Error &&
    [
      "Эта операция доступна только администратору",
      "Эта операция доступна только владельцу",
    ].includes(error.message)
  )
    return { message: error.message, status: 403 };
  console.error(
    "Operation failed",
    error instanceof Error ? error.name : "unknown",
  );
  return { message: "Не удалось выполнить операцию", status: 500 };
}
