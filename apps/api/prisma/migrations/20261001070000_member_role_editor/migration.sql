-- C18 roles: owner, admin, editor. The old default "member" becomes "editor".

-- AlterTable
ALTER TABLE "Member" ALTER COLUMN "role" SET DEFAULT 'editor';

UPDATE "Member" SET "role" = 'editor' WHERE "role" = 'member';
