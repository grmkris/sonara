ALTER TABLE "usage_ledger" ADD COLUMN "amount_cents" integer;--> statement-breakpoint
ALTER TABLE "usage_ledger" DROP COLUMN "amount_usd";