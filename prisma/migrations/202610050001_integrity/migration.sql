CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "Booking" ADD CONSTRAINT "booking_dates" CHECK ("end" > "start");
ALTER TABLE "Booking" ADD CONSTRAINT "booking_amount" CHECK ("totalCents" >= 0 AND "guestCount" > 0 AND "linen" >= 0);
ALTER TABLE "Room" ADD CONSTRAINT "room_capacity" CHECK ("capacity" > 0 AND "priceCents" >= 0);
ALTER TABLE "Payment" ADD CONSTRAINT "payment_amount" CHECK ("amountCents" <> 0);
-- Half-open intervals: checkout date can be the next guest's check-in date.
ALTER TABLE "Booking" ADD CONSTRAINT "room_no_overlap" EXCLUDE USING gist
 ("roomId" WITH =, daterange("start", "end", '[)') WITH &&)
 WHERE ("status" <> 'cancelled');
-- The application cannot edit or delete audit events, including through an accidental API.
CREATE FUNCTION audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Audit log is append-only';
END;
$$;
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON "AuditLog"
 FOR EACH ROW EXECUTE FUNCTION audit_append_only();
