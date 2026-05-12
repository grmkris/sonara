CREATE TABLE "allowed_email" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"note" text,
	"added_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "allowed_email" ADD CONSTRAINT "allowed_email_added_by_user_id_user_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "allowed_email_email_idx" ON "allowed_email" USING btree ("email");