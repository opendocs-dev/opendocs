-- C14-AC25 account settings: email notifications toggle, default on.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "emailNotifications" BOOLEAN NOT NULL DEFAULT true;
