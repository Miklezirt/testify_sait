import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { execFile, spawn } from "node:child_process";
import EmbeddedPostgres from "embedded-postgres";
import { hash } from "bcryptjs";
import { chromium } from "@playwright/test";
// A disposable REAL PostgreSQL cluster, never the configured production database.
test(
  "Hotel operations and HTTP security on real PostgreSQL",
  { timeout: 180000 },
  async (t) => {
    const folder = await mkdtemp(join(tmpdir(), "rooms-test-"));
    const password = randomBytes(24).toString("hex");
    const port = Number(process.env.TEST_PG_PORT || 55439);
    const pg = new EmbeddedPostgres({
      databaseDir: join(folder, "db"),
      port,
      user: "rooms_test",
      password,
      persistent: false,
      postgresFlags: ["-h", "127.0.0.1"],
    });
    let server: ReturnType<typeof spawn> | undefined;
    process.env.DATABASE_URL = `postgresql://rooms_test:${password}@127.0.0.1:${port}/hotel_test`;
    process.env.AUTH_SECRET = randomBytes(32).toString("hex");
    process.env.DOCUMENT_KEY = randomBytes(32).toString("hex");
    process.env.AUTH_URL = "http://localhost:3317";
    process.env.HOTEL_TIMEZONE = "Europe/Moscow";
    const { db } = await import("../../lib/db");
    const { operate } = await import("../../lib/operations");
    const { hotelToday } = await import("../../lib/domain");
    try {
      await pg.initialise();
      await pg.start();
      await pg.createDatabase("hotel_test");
      await promisify(execFile)(
        process.execPath,
        ["node_modules/prisma/build/index.js", "migrate", "deploy"],
        { env: process.env },
      );
      const loginPassword = randomBytes(12).toString("hex");
      const owner = await db.user.create({
        data: {
          name: "Test Owner",
          email: "owner@test.invalid",
          role: "owner",
          passwordHash: await hash(loginPassword, 4),
        },
      });
      const admin = await db.user.create({
        data: {
          name: "Test Admin",
          email: "admin@test.invalid",
          role: "admin",
          passwordHash: await hash(loginPassword, 4),
        },
      });
      const staff = await db.user.create({
        data: {
          name: "Test Staff",
          email: "staff@test.invalid",
          role: "staff",
          passwordHash: await hash(loginPassword, 4),
        },
      });
      const g = await operate(admin, "guest", { name: "Fictional Guest" });
      const roomId = await operate(admin, "room", {
        name: "Test 11",
        capacity: 2,
        priceCents: 300000,
        status: "ready",
      });
      const today = hotelToday(),
        next = (n: number) =>
          new Date(new Date(today).getTime() + n * 86400000)
            .toISOString()
            .slice(0, 10);
      const draft = {
        roomId,
        guestId: g,
        start: today,
        end: next(3),
        guestCount: 2,
        linen: 2,
        totalCents: 900000,
        prepaymentCents: 100000,
        method: "transfer",
      };
      let bookingId = "";
      await t.test(
        "Concurrent reservations: exactly one succeeds",
        async () => {
          const results = await Promise.allSettled([
            operate(admin, "booking", draft),
            operate(admin, "booking", draft),
          ]);
          assert.equal(
            results.filter((r) => r.status === "fulfilled").length,
            1,
          );
          bookingId = (
            results.find(
              (r) => r.status === "fulfilled",
            ) as PromiseFulfilledResult<string>
          ).value;
          assert.equal(await db.booking.count(), 1);
        },
      );
      await t.test(
        "Database rejects overlap even outside the application",
        async () => {
          await assert.rejects(
            db.booking.create({
              data: {
                roomId,
                guestId: g,
                start: new Date(today),
                end: new Date(next(2)),
                guestCount: 1,
                totalCents: 1,
              },
            }),
          );
        },
      );
      await t.test("Capacity and staff/owner permissions", async () => {
        await assert.rejects(
          operate(admin, "booking", {
            ...draft,
            start: next(5),
            end: next(6),
            guestCount: 3,
          }),
        );
        await assert.rejects(
          operate(staff, "room", {
            name: "Forbidden",
            capacity: 2,
            priceCents: 0,
            status: "ready",
          }),
        );
        await assert.rejects(
          operate(admin, "user", {
            name: "Forbidden",
            email: "new@test.invalid",
            password: loginPassword,
            role: "owner",
            active: true,
          }),
        );
      });
      await t.test(
        "Adjacent stay, edit conflict, payment/overpayment/refund",
        async () => {
          await operate(admin, "booking", {
            ...draft,
            start: next(3),
            end: next(4),
            prepaymentCents: 0,
          });
          let b = await db.booking.findUniqueOrThrow({
            where: { id: bookingId },
          });
          await operate(admin, "booking", {
            ...draft,
            id: b.id,
            version: b.version,
            totalCents: 950000,
            prepaymentCents: 0,
          });
          await assert.rejects(
            operate(admin, "booking", {
              ...draft,
              id: b.id,
              version: b.version,
              prepaymentCents: 0,
            }),
          );
          await operate(admin, "payment", {
            bookingId,
            amountCents: 200000,
            method: "cash",
          });
          await assert.rejects(
            operate(admin, "payment", {
              bookingId,
              amountCents: 9999999,
              method: "cash",
            }),
          );
          await assert.rejects(
            operate(admin, "payment", {
              bookingId,
              amountCents: 1,
              method: "cash",
              refund: true,
            }),
          );
          await operate(owner, "payment", {
            bookingId,
            amountCents: 50000,
            method: "cash",
            refund: true,
          });
          b = await db.booking.findUniqueOrThrow({ where: { id: bookingId } });
          assert.equal(b.totalCents, 950000);
        },
      );
      await t.test(
        "Check-in, checkout, cleaning gate and completion",
        async () => {
          let b = await db.booking.findUniqueOrThrow({
            where: { id: bookingId },
          });
          await operate(staff, "status", {
            id: b.id,
            version: b.version,
            status: "checked_in",
          });
          b = await db.booking.findUniqueOrThrow({ where: { id: bookingId } });
          await assert.rejects(
            operate(admin, "status", {
              id: b.id,
              version: b.version,
              status: "cancelled",
            }),
          );
          await operate(admin, "booking", {
            ...draft,
            id: b.id,
            version: b.version,
            end: next(2),
            totalCents: 950000,
            prepaymentCents: 0,
          });
          b = await db.booking.findUniqueOrThrow({ where: { id: b.id } });
          await operate(admin, "status", {
            id: b.id,
            version: b.version,
            status: "completed",
          });
          assert.equal(
            (await db.room.findUniqueOrThrow({ where: { id: roomId } })).status,
            "cleaning",
          );
          const task = await db.cleaningTask.findFirstOrThrow({
            where: { roomId, done: false },
          });
          await operate(staff, "clean", { id: task.id });
          assert.equal(
            (await db.room.findUniqueOrThrow({ where: { id: roomId } })).status,
            "ready",
          );
        },
      );
      await t.test(
        "Cancelled stays release dates, journal is immutable",
        async () => {
          const b = await db.booking.findFirstOrThrow({
            where: { status: "booked" },
          });
          await operate(admin, "status", {
            id: b.id,
            version: b.version,
            status: "cancelled",
          });
          await operate(admin, "booking", {
            ...draft,
            start: next(3),
            end: next(4),
            prepaymentCents: 0,
          });
          const event = await db.auditLog.findFirstOrThrow();
          await assert.rejects(db.auditLog.delete({ where: { id: event.id } }));
          await assert.rejects(
            db.auditLog.update({
              where: { id: event.id },
              data: { action: "tampered" },
            }),
          );
          assert.ok(
            (await db.auditLog.count({ where: { userId: admin.id } })) > 0,
          );
        },
      );
      await t.test(
        "Cleaning completion preserves a maintenance block",
        async () => {
          const id = await operate(admin, "room", {
            name: "Maintenance Test",
            capacity: 1,
            priceCents: 0,
            status: "cleaning",
          });
          const task = await db.cleaningTask.findFirstOrThrow({
            where: { roomId: id, done: false },
          });
          await operate(admin, "room", {
            id,
            name: "Maintenance Test",
            capacity: 1,
            priceCents: 0,
            status: "maintenance",
          });
          await operate(staff, "clean", { id: task.id });
          assert.equal(
            (await db.room.findUniqueOrThrow({ where: { id } })).status,
            "maintenance",
          );
        },
      );
      // Production server tests exercise Auth.js cookies, authorization, origin checks and private files.
      server = spawn(
        process.execPath,
        ["node_modules/next/dist/bin/next", "start", "-p", "3317"],
        {
          env: { ...process.env, NODE_ENV: "production" },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let log = "";
      server.stdout?.on("data", (d) => {
        log += d.toString();
      });
      server.stderr?.on("data", (d) => {
        log += d.toString();
      });
      for (let i = 0; i < 100; i++) {
        try {
          if ((await fetch("http://localhost:3317/login")).ok) break;
        } catch {}
        await new Promise((r) => setTimeout(r, 100));
        if (i === 99) throw Error(log);
      }
      const base = "http://localhost:3317";
      async function login(email: string, password = loginPassword) {
        const csrfRes = await fetch(base + "/api/auth/csrf");
        const csrf = await csrfRes.json();
        const initial = csrfRes.headers
          .getSetCookie()
          .map((v) => v.split(";")[0])
          .join("; ");
        const res = await fetch(base + "/api/auth/callback/credentials", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Cookie: initial,
            Origin: base,
          },
          body: new URLSearchParams({
            csrfToken: csrf.csrfToken,
            email,
            password,
            callbackUrl: base,
          }),
          redirect: "manual",
        });
        return (
          initial +
          "; " +
          res.headers
            .getSetCookie()
            .map((v) => v.split(";")[0])
            .join("; ")
        );
      }
      await t.test(
        "Anonymous access denied; separate roles checked by the server",
        async () => {
          assert.equal((await fetch(base + "/api/data")).status, 401);
          assert.equal((await fetch(base + "/api/audit")).status, 401);
          const cookie = await login(admin.email);
          assert.equal(
            (await fetch(base + "/api/data", { headers: { Cookie: cookie } }))
              .status,
            200,
          );
          assert.equal(
            (await fetch(base + "/api/audit", { headers: { Cookie: cookie } }))
              .status,
            403,
          );
          const res = await fetch(base + "/api/operation", {
            method: "POST",
            headers: {
              Cookie: cookie,
              Origin: "https://evil.invalid",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ op: "guest", data: { name: "Forbidden" } }),
          });
          assert.equal(res.status, 403);
        },
      );
      await t.test(
        "Encrypted file round-trip, staff/anonymous denial and no public cache",
        async () => {
          const cookie = await login(admin.email),
            staffCookie = await login(staff.email);
          const form = new FormData();
          form.set("guestId", g);
          form.set(
            "file",
            new File(["%PDF-1.7\nFictional document only"], "demo.pdf", {
              type: "application/pdf",
            }),
          );
          const res = await fetch(base + "/api/documents", {
            method: "POST",
            headers: { Cookie: cookie, Origin: base },
            body: form,
          });
          assert.equal(res.status, 200, await res.clone().text());
          const { id } = await res.json();
          const saved = await db.document.findUniqueOrThrow({ where: { id } });
          assert.ok(
            !Buffer.from(saved.ciphertext).includes(Buffer.from("Fictional")),
          );
          assert.equal(
            (await fetch(base + "/api/documents/" + id)).status,
            401,
          );
          assert.equal(
            (
              await fetch(base + "/api/documents/" + id, {
                headers: { Cookie: staffCookie },
              })
            ).status,
            403,
          );
          const download = await fetch(base + "/api/documents/" + id, {
            headers: { Cookie: cookie },
          });
          assert.equal(
            download.headers.get("cache-control"),
            "private, no-store",
          );
          assert.ok(
            (await download.text()).includes("Fictional document only"),
          );
        },
      );
      await t.test(
        "Password changes revoke previous session and owner exports journal",
        async () => {
          const cookie = await login(admin.email);
          await operate(owner, "user", {
            id: admin.id,
            name: admin.name,
            email: admin.email,
            role: "admin",
            active: true,
            password: randomBytes(15).toString("hex"),
          });
          assert.equal(
            (await fetch(base + "/api/data", { headers: { Cookie: cookie } }))
              .status,
            401,
          );
          const ownerCookie = await login(owner.email);
          const exportRes = await fetch(base + "/api/audit", {
            headers: { Cookie: ownerCookie },
          });
          assert.equal(exportRes.status, 200);
          assert.ok((await exportRes.text()).includes("booking.create"));
        },
      );
      await t.test(
        "Demo seed creates four rooms and is repeatable",
        async () => {
          const env = {
            ...process.env,
            SEED_OWNER_EMAIL: "seed-owner@test.invalid",
            SEED_OWNER_PASSWORD: loginPassword,
            SEED_ADMIN_EMAIL: "seed-admin@test.invalid",
            SEED_ADMIN_PASSWORD: loginPassword,
            SEED_STAFF_EMAIL: "seed-staff@test.invalid",
            SEED_STAFF_PASSWORD: loginPassword,
            SEED_DEMO: "true",
          };
          for (let i = 0; i < 2; i++)
            await promisify(execFile)(
              process.execPath,
              ["--import", "tsx", "prisma/seed.ts"],
              { env },
            );
          assert.equal(
            await db.room.count({ where: { id: { startsWith: "demo-" } } }),
            4,
          );
          assert.equal(
            await db.booking.count({ where: { id: { startsWith: "demo-" } } }),
            4,
          );
        },
      );
      if (process.env.TEST_BROWSER === "true")
        await t.test(
          "Desktop/mobile interface and owner account management",
          async () => {
            const browser = await chromium.launch({ headless: true });
            try {
              const page = await browser.newPage();
              await page.goto(base + "/login");
              await page.getByLabel("Email", { exact: true }).fill(owner.email);
              await page
                .getByLabel("Пароль", { exact: true })
                .fill(loginPassword);
              await page
                .getByRole("button", { name: "Войти", exact: true })
                .click();
              await page
                .getByRole("heading", { name: /Сегодня/, level: 1 })
                .waitFor();
              await page
                .getByRole("button", { name: "Учётные записи", exact: true })
                .click();
              await page
                .getByRole("button", { name: "+ Учётная запись", exact: true })
                .click();
              await page
                .getByLabel("Имя", { exact: true })
                .fill("Browser Employee");
              await page
                .getByLabel("Email — логин")
                .fill("browser@test.invalid");
              await page
                .getByLabel("Пароль", { exact: true })
                .fill(loginPassword);
              await page
                .getByRole("button", { name: "Сохранить", exact: true })
                .click();
              await page
                .getByRole("heading", { name: "Browser Employee" })
                .waitFor();
              await page
                .getByRole("button", { name: "Главная", exact: true })
                .click();
              await page.screenshot({
                path: join(
                  process.env.TEST_ARTIFACT_DIR || folder,
                  "desktop.png",
                ),
                fullPage: true,
              });
              await page.setViewportSize({ width: 390, height: 844 });
              await page
                .getByRole("button", { name: "Календарь", exact: true })
                .click();
              await page
                .getByRole("heading", { name: "Календарь", exact: true })
                .waitFor();
              await page.screenshot({
                path: join(
                  process.env.TEST_ARTIFACT_DIR || folder,
                  "mobile.png",
                ),
                fullPage: true,
              });
              assert.ok(
                await page.evaluate(
                  () =>
                    document.documentElement.scrollWidth <= window.innerWidth,
                ),
              );
              await page.screenshot({
                path: join(
                  process.env.TEST_ARTIFACT_DIR || folder,
                  "mobile.png",
                ),
                fullPage: true,
              });
            } finally {
              await browser.close();
            }
          },
        );
    } finally {
      server?.kill("SIGTERM");
      await db.$disconnect();
      await pg.stop().catch(() => {});
      await rm(folder, { recursive: true, force: true });
    }
  },
);
