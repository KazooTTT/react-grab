import { PrismaClient } from "@prisma/client";

let db: PrismaClient;

declare global {
  // eslint-disable-next-line no-var
  var __remix_prisma__: PrismaClient | undefined;
}

if (process.env.NODE_ENV === "production") {
  db = new PrismaClient();
} else {
  if (!global.__remix_prisma__) {
    global.__remix_prisma__ = new PrismaClient();
  }
  db = global.__remix_prisma__;
}

export { db };
