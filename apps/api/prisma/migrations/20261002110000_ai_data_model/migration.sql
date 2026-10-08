-- CreateTable
CREATE TABLE "AiAssistant" (
    "organizationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT NOT NULL DEFAULT 'AI Assistant',
    "buttonLabel" TEXT NOT NULL DEFAULT 'Ask AI',
    "welcome" TEXT NOT NULL DEFAULT 'How can I help you today?',
    "suggested" JSONB NOT NULL DEFAULT '[]',
    "tone" TEXT NOT NULL DEFAULT 'friendly',
    "language" TEXT NOT NULL DEFAULT 'auto',
    "sourceMode" TEXT NOT NULL DEFAULT 'all',
    "sourceCategoryIds" JSONB NOT NULL DEFAULT '[]',
    "excludedFlowIds" JSONB NOT NULL DEFAULT '[]',
    "noMatchMode" TEXT NOT NULL DEFAULT 'contact',
    "contactTarget" TEXT NOT NULL DEFAULT '',
    "offTopicRefusal" BOOLEAN NOT NULL DEFAULT true,
    "showSources" BOOLEAN NOT NULL DEFAULT true,
    "hourlyPerVisitor" INTEGER NOT NULL DEFAULT 30,
    "dailyCap" INTEGER NOT NULL DEFAULT 500,
    "retentionDays" INTEGER NOT NULL DEFAULT 30,
    "maskPii" BOOLEAN NOT NULL DEFAULT true,
    "position" TEXT NOT NULL DEFAULT 'bottom-right',
    "modelId" TEXT,
    "byoEnabled" BOOLEAN NOT NULL DEFAULT false,
    "byoProvider" TEXT,
    "byoBaseUrl" TEXT,
    "byoModel" TEXT,
    "byoSecret" TEXT,
    "byoFallbackCredits" BOOLEAN NOT NULL DEFAULT false,
    "embedOrigins" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiAssistant_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "AiCreditLedger" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "messageId" TEXT,
    "modelId" TEXT,
    "credits" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiCreditLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiConversation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "citedFlowIds" JSONB NOT NULL DEFAULT '[]',
    "answered" BOOLEAN NOT NULL DEFAULT true,
    "rating" TEXT,
    "feedback" TEXT,
    "tokensUsed" INTEGER NOT NULL DEFAULT 0,
    "modelId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiCreditLedger_organizationId_createdAt_idx" ON "AiCreditLedger"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AiCreditLedger_organizationId_messageId_idx" ON "AiCreditLedger"("organizationId", "messageId");

-- CreateIndex
CREATE UNIQUE INDEX "AiCreditLedger_organizationId_messageId_reason_key" ON "AiCreditLedger"("organizationId", "messageId", "reason");

-- CreateIndex
CREATE INDEX "AiConversation_organizationId_updatedAt_idx" ON "AiConversation"("organizationId", "updatedAt");

-- CreateIndex
CREATE INDEX "AiConversation_organizationId_visitorId_idx" ON "AiConversation"("organizationId", "visitorId");

-- CreateIndex
CREATE INDEX "AiMessage_conversationId_createdAt_idx" ON "AiMessage"("conversationId", "createdAt");

-- AddForeignKey
ALTER TABLE "AiAssistant" ADD CONSTRAINT "AiAssistant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiCreditLedger" ADD CONSTRAINT "AiCreditLedger_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiConversation" ADD CONSTRAINT "AiConversation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
