ALTER TABLE "image_library" ADD COLUMN "trigger_reason" text;--> statement-breakpoint
ALTER TABLE "image_library" ADD COLUMN "anchor_url" text;--> statement-breakpoint
ALTER TABLE "image_library" ADD COLUMN "inspector_context" jsonb;