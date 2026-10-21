CREATE TABLE "layouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"generation_id" uuid NOT NULL,
	"inputs" jsonb NOT NULL,
	"placements" jsonb NOT NULL,
	"score" real NOT NULL,
	"score_breakdown" jsonb NOT NULL,
	"llm_intent" jsonb,
	"prompt_version" text NOT NULL,
	"status" text DEFAULT 'candidate' NOT NULL,
	"screenshot_urls" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"article_no" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"price_cad" numeric(10, 2) NOT NULL,
	"url" text NOT NULL,
	"dims" jsonb NOT NULL,
	"model_url" text,
	"model_source" text NOT NULL,
	"style_tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"scraped_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"layout_a" uuid NOT NULL,
	"layout_b" uuid NOT NULL,
	"winner" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"room_type" text NOT NULL,
	"walls" jsonb NOT NULL,
	"openings" jsonb NOT NULL,
	"materials" jsonb NOT NULL,
	"source_image_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "layouts" ADD CONSTRAINT "layouts_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_layout_a_layouts_id_fk" FOREIGN KEY ("layout_a") REFERENCES "public"."layouts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_layout_b_layouts_id_fk" FOREIGN KEY ("layout_b") REFERENCES "public"."layouts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "layouts_room_id_idx" ON "layouts" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "layouts_generation_id_idx" ON "layouts" USING btree ("generation_id");--> statement-breakpoint
CREATE INDEX "products_category_idx" ON "products" USING btree ("category");