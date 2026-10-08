-- AlterTable User
ALTER TABLE "User" ADD COLUMN "notifyWeeklyDigest" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "notifyAiCredits" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "notifyContentGaps" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "notifyInviteAccepted" BOOLEAN NOT NULL DEFAULT true;

-- Migrate existing User preferences: copy emailNotifications value to the 4 toggles
UPDATE "User" SET
  "notifyWeeklyDigest" = "emailNotifications",
  "notifyAiCredits" = "emailNotifications",
  "notifyContentGaps" = "emailNotifications",
  "notifyInviteAccepted" = "emailNotifications";

-- AlterTable Account
ALTER TABLE "Account" ADD COLUMN "username" TEXT;

-- AlterTable Member
ALTER TABLE "Member" ADD COLUMN "lastActiveAt" TIMESTAMP(3);
