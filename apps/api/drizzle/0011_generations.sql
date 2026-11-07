CREATE TABLE "generations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"floorplan_id" uuid NOT NULL,
	"account_id" uuid,
	"route" text NOT NULL,
	"room_id" text,
	"status" text NOT NULL,
	"rooms" jsonb NOT NULL,
	"error" text,
	"layout_id" uuid,
	"furniture" jsonb,
	"cost_usd" numeric(10, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_floorplan_id_floorplans_id_fk" FOREIGN KEY ("floorplan_id") REFERENCES "public"."floorplans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generations_floorplan_status_idx" ON "generations" USING btree ("floorplan_id","status");--> statement-breakpoint
CREATE INDEX "generations_account_status_idx" ON "generations" USING btree ("account_id","status");