import { defineConfig } from "prisma/config";

// The Prisma CLI runs in its own process, which does not inherit Bun's .env loading.
if (!process.env["DATABASE_URL"]) {
  try {
    process.loadEnvFile();
  } catch {
    // No local .env; rely on the ambient environment.
  }
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
