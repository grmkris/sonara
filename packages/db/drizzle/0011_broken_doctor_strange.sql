CREATE TABLE "generation_job" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"set_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"description" text,
	"style_anchor" text NOT NULL,
	"look" jsonb,
	"prompts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"total" integer NOT NULL,
	"cursor" integer DEFAULT 0 NOT NULL,
	"insert_at" integer,
	"lease_expires_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generation_job" ADD CONSTRAINT "generation_job_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_job" ADD CONSTRAINT "generation_job_set_id_frame_set_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."frame_set"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generation_job_status_lease_idx" ON "generation_job" USING btree ("status","lease_expires_at");--> statement-breakpoint
CREATE INDEX "generation_job_set_idx" ON "generation_job" USING btree ("set_id");