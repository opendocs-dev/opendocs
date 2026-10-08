-- CreateTable
CREATE TABLE "AnalyticsDaily" (
    "flowId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "searches" INTEGER NOT NULL DEFAULT 0,
    "helpfulYes" INTEGER NOT NULL DEFAULT 0,
    "helpfulNo" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AnalyticsDaily_pkey" PRIMARY KEY ("flowId","day")
);

-- CreateTable
CREATE TABLE "SearchLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "query" TEXT NOT NULL,
    "results" INTEGER NOT NULL DEFAULT 0,
    "times" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "SearchLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnalyticsDaily_day_idx" ON "AnalyticsDaily"("day");

-- CreateIndex
CREATE INDEX "AnalyticsDaily_flowId_idx" ON "AnalyticsDaily"("flowId");

-- CreateIndex
CREATE INDEX "SearchLog_organizationId_day_idx" ON "SearchLog"("organizationId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "SearchLog_organizationId_day_query_key" ON "SearchLog"("organizationId", "day", "query");

-- AddForeignKey
ALTER TABLE "AnalyticsDaily" ADD CONSTRAINT "AnalyticsDaily_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchLog" ADD CONSTRAINT "SearchLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
