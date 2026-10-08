-- CreateTable
CREATE TABLE "PlanConfig" (
    "plan" TEXT NOT NULL,
    "monthlyCredits" INTEGER NOT NULL DEFAULT 0,
    "byokAllowed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanConfig_pkey" PRIMARY KEY ("plan")
);

-- CreateTable
CREATE TABLE "AiModel" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "creditsPerReply" INTEGER NOT NULL DEFAULT 1,
    "plans" JSONB NOT NULL DEFAULT '["pro","enterprise"]',
    "status" TEXT NOT NULL DEFAULT 'active',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiProvider" (
    "provider" TEXT NOT NULL,
    "baseUrl" TEXT,
    "secret" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastTestedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiProvider_pkey" PRIMARY KEY ("provider")
);

-- CreateTable
CREATE TABLE "AiPlatformSettings" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "aiEnabled" BOOLEAN NOT NULL DEFAULT true,
    "spendCapMonthly" DOUBLE PRECISION NOT NULL DEFAULT 500.0,
    "currentMonthSpend" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "alertPercent" INTEGER NOT NULL DEFAULT 80,
    "pauseAtCap" BOOLEAN NOT NULL DEFAULT true,
    "creditOverageAction" TEXT NOT NULL DEFAULT 'stop',
    "chargeOnlyWhenDelivered" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiPlatformSettings_pkey" PRIMARY KEY ("id")
);

-- Seed: PlanConfig
INSERT INTO "PlanConfig" ("plan", "monthlyCredits", "byokAllowed", "createdAt", "updatedAt") VALUES
  ('free', 0, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('pro', 1000, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('enterprise', 10000, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("plan") DO NOTHING;

-- Seed: AiModel catalog
INSERT INTO "AiModel" ("id", "provider", "modelId", "name", "label", "creditsPerReply", "plans", "status", "isDefault", "createdAt", "updatedAt") VALUES
  ('model-gpt-luna', 'openai', 'gpt-luna', 'GPT Luna', 'Standard', 1, '["pro","enterprise"]'::jsonb, 'active', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('model-claude-sonnet-5-5', 'anthropic', 'claude-sonnet-5-5', 'Claude Sonnet', 'Advanced', 5, '["pro","enterprise"]'::jsonb, 'active', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('model-gpt-luna-mini', 'openai', 'gpt-luna-mini', 'GPT Luna Mini', 'Standard', 1, '["pro","enterprise"]'::jsonb, 'hidden', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- Seed: AiPlatformSettings
INSERT INTO "AiPlatformSettings" ("id", "aiEnabled", "spendCapMonthly", "currentMonthSpend", "alertPercent", "pauseAtCap", "creditOverageAction", "chargeOnlyWhenDelivered", "updatedAt") VALUES
  ('global', true, 500.0, 0.0, 80, true, 'stop', true, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
