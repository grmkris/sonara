CREATE TABLE "stage" (
	"code" text NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"name" text NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "frame_set" ADD COLUMN "stage_id" uuid;--> statement-breakpoint
ALTER TABLE "stage" ADD CONSTRAINT "stage_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stage_code_idx" ON "stage" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "stage_user_default_idx" ON "stage" USING btree ("user_id") WHERE is_default;--> statement-breakpoint
CREATE INDEX "stage_user_idx" ON "stage" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "frame_set" ADD CONSTRAINT "frame_set_stage_id_stage_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."stage"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "frame_set_stage_created_idx" ON "frame_set" USING btree ("stage_id","created_at" DESC NULLS LAST);