const LOCAL_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/** Pick raw PostgreSQL only for an explicit non-production local target. */
export function databasePoolDriver(databaseUrl, environment = "production") {
  let hostname;
  try {
    hostname = new URL(databaseUrl).hostname;
  } catch {
    return "neon";
  }
  return environment !== "production" && LOCAL_DATABASE_HOSTS.has(hostname) ? "pg" : "neon";
}

export async function createDatabasePool({ databaseUrl, environment = "production", importer = (specifier) => import(specifier) } = {}) {
  try {
    const driver = databasePoolDriver(databaseUrl, environment);
    const { Pool } = await importer(driver === "pg" ? "pg" : "@neondatabase/serverless");
    return new Pool({ connectionString: databaseUrl });
  } catch {
    throw new Error("DATABASE_POOL_UNAVAILABLE");
  }
}
