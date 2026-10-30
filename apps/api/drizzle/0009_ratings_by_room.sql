ALTER TABLE "floorplans" ADD COLUMN "source" text DEFAULT 'upload' NOT NULL;--> statement-breakpoint
ALTER TABLE "ratings" ADD COLUMN "room_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "ratings" ADD COLUMN "account_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "ratings" ADD COLUMN "livable" boolean;--> statement-breakpoint
ALTER TABLE "ratings" ADD COLUMN "item_notes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ratings" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "ratings" ADD COLUMN "labels" jsonb;--> statement-breakpoint
ALTER TABLE "ratings" ADD COLUMN "source" text DEFAULT 'pair' NOT NULL;--> statement-breakpoint
ALTER TABLE "ratings" ADD COLUMN "seconds" real;