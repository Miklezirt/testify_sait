import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bookingSchema,
  overlaps,
  canTransition,
  hotelToday,
  requireAdmin,
  requireOwner,
} from "../lib/domain";
import { encrypt, decrypt, fileType } from "../lib/crypto";
const base = {
  roomId: "r",
  guestId: "g",
  start: "2026-10-05",
  end: "2026-10-08",
  guestCount: 2,
  linen: 2,
  totalCents: 1500000,
};
test("Half-open stays permit same-day turnover, reject all overlap shapes", () => {
  assert.equal(
    overlaps("2026-10-05", "2026-10-08", "2026-10-08", "2026-10-10"),
    false,
  );
  for (const [s, e] of [
    ["2026-10-04", "2026-10-06"],
    ["2026-10-06", "2026-10-09"],
    ["2026-10-04", "2026-10-09"],
    ["2026-10-06", "2026-10-07"],
  ])
    assert.equal(overlaps(base.start, base.end, s, e), true);
});
test("Booking validation rejects reversed dates, impossible dates and invalid money", () => {
  assert.ok(bookingSchema.safeParse(base).success);
  for (const changes of [
    { end: base.start },
    { start: "2026-02-30" },
    { totalCents: 1.5 },
    { prepaymentCents: 2000000 },
    { guestCount: 0 },
  ])
    assert.equal(
      bookingSchema.safeParse({ ...base, ...changes }).success,
      false,
    );
});
test("Status lifecycle excludes cancellation of occupied or completed stays", () => {
  assert.ok(canTransition("booked", "checked_in"));
  assert.ok(canTransition("booked", "cancelled"));
  assert.ok(canTransition("checked_in", "completed"));
  assert.equal(canTransition("checked_in", "cancelled"), false);
  assert.equal(canTransition("completed", "booked"), false);
});
test("Hotel date respects local midnight", () => {
  process.env.HOTEL_TIMEZONE = "Europe/Moscow";
  assert.equal(hotelToday(new Date("2026-10-04T22:30:00Z")), "2026-10-05");
});
test("Owner and hotel administrator have separate permissions", () => {
  requireAdmin("owner");
  requireAdmin("admin");
  assert.throws(() => requireAdmin("staff"));
  requireOwner("owner");
  assert.throws(() => requireOwner("admin"));
});
test("Documents encrypt, reject corruption and require a key", () => {
  process.env.DOCUMENT_KEY = "ab".repeat(32);
  const plaintext = Buffer.from("Fictional document");
  const secured = encrypt(plaintext);
  assert.ok(!secured.ciphertext.equals(plaintext));
  assert.deepEqual(decrypt(secured), plaintext);
  secured.tag[0] ^= 1;
  assert.throws(() => decrypt(secured));
  delete process.env.DOCUMENT_KEY;
  assert.throws(() => encrypt(plaintext));
});
test("File type is read from content, executable/SVG is rejected", () => {
  assert.equal(fileType(Buffer.from("%PDF-1.7")), "application/pdf");
  assert.equal(fileType(Buffer.from("<svg>")), null);
  assert.equal(fileType(Buffer.from("MZ")), null);
});
