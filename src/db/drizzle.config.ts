import { defineConfig } from "drizzle-kit";

const sqlHost = process.env.SQL_HOST;
const sqlDbName = process.env.SQL_DB_NAME;
const user = process.env.SQL_ADMIN_USER;
const password = process.env.SQL_ADMIN_PASSWORD;

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  schemaFilter: ["public"],
  dbCredentials: {
    host: sqlHost || 'localhost',
    user: user || 'postgres',
    password: password || 'postgres',
    database: sqlDbName || 'app',
    ssl: false,
  },
  verbose: true,
});
