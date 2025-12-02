/**
 * Example Drizzle configuration for generating migrations.
 *
 * Copy this to your project root as `drizzle.config.ts` and adjust paths as needed.
 */

import type { Config } from 'drizzle-kit';

export default {
  schema: './schema/*',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'myapp',
  },
} satisfies Config;

/**
 * Usage:
 *
 * 1. Create a schema file (e.g., schema/users.ts):
 *
 *    import { pgTable, serial, text } from 'drizzle-orm/pg-core';
 *    import { stripeBillableFields } from '@yourlib/domain/drizzle';
 *
 *    export const users = pgTable('users', {
 *      id: serial('id').primaryKey(),
 *      email: text('email').notNull(),
 *      ...stripeBillableFields(),
 *    });
 *
 * 2. Generate migration:
 *
 *    npx drizzle-kit generate
 *
 * 3. Review the generated SQL in drizzle/migrations/
 *
 * 4. Apply migration:
 *
 *    npx drizzle-kit migrate
 *
 * Example generated SQL:
 *
 *    CREATE TABLE IF NOT EXISTS "users" (
 *      "id" serial PRIMARY KEY NOT NULL,
 *      "email" text NOT NULL,
 *      "stripe_customer_id" text,
 *      CONSTRAINT "users_stripe_customer_id_unique" UNIQUE("stripe_customer_id")
 *    );
 */
