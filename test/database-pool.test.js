import { describe, expect, test } from "bun:test";

import { createDatabasePool, databasePoolDriver } from "../scripts/database-pool.mjs";

describe("database CLI pool selection", () => {
  test("uses node-postgres for an explicit non-production localhost target", async () => {
    const imports = [];
    class FakePool {
      constructor(options) {
        this.options = options;
      }
    }

    expect(databasePoolDriver("postgresql://postgres:secret@127.0.0.1:5432/app", "fresh")).toBe("pg");
    const pool = await createDatabasePool({
      databaseUrl: "postgresql://postgres:secret@127.0.0.1:5432/app",
      environment: "fresh",
      importer: async (specifier) => {
        imports.push(specifier);
        return { Pool: FakePool };
      },
    });

    expect(imports).toEqual(["pg"]);
    expect(pool.options).toEqual({ connectionString: "postgresql://postgres:secret@127.0.0.1:5432/app" });
  });

  test("uses node-postgres for an explicit non-production IPv6 loopback target", () => {
    expect(databasePoolDriver("postgresql://postgres:secret@[::1]:5432/app", "test")).toBe("pg");
  });

  test("keeps the Neon serverless pool for hosted targets", async () => {
    const imports = [];
    class FakePool {}

    expect(databasePoolDriver("postgresql://owner:secret@ep-example.aws.neon.tech/neondb", "production")).toBe("neon");
    await createDatabasePool({
      databaseUrl: "postgresql://owner:secret@ep-example.aws.neon.tech/neondb",
      environment: "production",
      importer: async (specifier) => {
        imports.push(specifier);
        return { Pool: FakePool };
      },
    });

    expect(imports).toEqual(["@neondatabase/serverless"]);
  });

  test("keeps driver and connection failures opaque", async () => {
    await expect(createDatabasePool({
      databaseUrl: "postgresql://postgres:secret@127.0.0.1:5432/app",
      environment: "fresh",
      importer: async () => { throw new Error("postgresql://postgres:secret@host/db"); },
    })).rejects.toThrow("DATABASE_POOL_UNAVAILABLE");
  });
});
