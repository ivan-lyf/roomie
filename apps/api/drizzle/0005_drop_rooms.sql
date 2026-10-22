ALTER TABLE "layouts" DROP CONSTRAINT "layouts_room_id_rooms_id_fk";
--> statement-breakpoint
DROP INDEX "layouts_room_id_idx";--> statement-breakpoint
ALTER TABLE "layouts" DROP COLUMN "room_id";--> statement-breakpoint
DROP TABLE "rooms" CASCADE;
