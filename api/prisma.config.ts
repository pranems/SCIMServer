import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Phase 3: PostgreSQL connection string
    url: env('DATABASE_URL') ?? 'postgresql://scim:scim@localhost:5432/scimdb',
  },
});
