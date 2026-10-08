-- CreateTable
CREATE TABLE "Apikey" (
    "id" TEXT NOT NULL,
    "configId" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT,
    "start" TEXT,
    "referenceId" TEXT NOT NULL,
    "prefix" TEXT,
    "key" TEXT NOT NULL,
    "refillInterval" INTEGER,
    "refillAmount" INTEGER,
    "lastRefillAt" TIMESTAMP(3),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "rateLimitEnabled" BOOLEAN NOT NULL DEFAULT true,
    "rateLimitTimeWindow" INTEGER DEFAULT 86400000,
    "rateLimitMax" INTEGER DEFAULT 10,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "remaining" INTEGER,
    "lastRequest" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "permissions" TEXT,
    "metadata" TEXT,
    "termsAcceptedAt" TIMESTAMP(3),

    CONSTRAINT "Apikey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Apikey_configId_idx" ON "Apikey"("configId");

-- CreateIndex
CREATE INDEX "Apikey_referenceId_idx" ON "Apikey"("referenceId");

-- CreateIndex
CREATE INDEX "Apikey_key_idx" ON "Apikey"("key");
