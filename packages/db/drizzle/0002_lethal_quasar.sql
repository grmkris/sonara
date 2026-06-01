DROP INDEX "image_library_prompt_hash_idx";--> statement-breakpoint
ALTER TABLE "image_library" ADD COLUMN "source" text DEFAULT 'seed' NOT NULL;--> statement-breakpoint
ALTER TABLE "image_library" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "image_library" ADD COLUMN "session_id" text;--> statement-breakpoint
ALTER TABLE "image_library" ADD COLUMN "t_ms" integer;--> statement-breakpoint
ALTER TABLE "image_library" ADD COLUMN "position" integer;--> statement-breakpoint
ALTER TABLE "image_library" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "image_library" ADD CONSTRAINT "image_library_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "image_library_user_created_idx" ON "image_library" USING btree ("user_id","created_at" DESC NULLS LAST) WHERE source = 'generated' OR source = 'story';--> statement-breakpoint
CREATE INDEX "image_library_session_tms_idx" ON "image_library" USING btree ("session_id","t_ms") WHERE session_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "image_library_prompt_hash_idx" ON "image_library" USING btree ("prompt_hash") WHERE source = 'seed';