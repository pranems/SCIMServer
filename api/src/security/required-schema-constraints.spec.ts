/**
 * Schema constraint regression tests.
 *
 * Asserts that Prisma `schema.prisma` declares specific `@@unique` and `@@index`
 * constraints that the audit identified as required for data integrity. A
 * future maintainer who removes one of these will fail this spec immediately,
 * with a pointer to the original audit ID.
 *
 * Add a new entry to REQUIRED_CONSTRAINTS whenever you add a defense-in-depth
 * constraint to the schema that must never be silently removed.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

const SCHEMA_PATH = path.resolve(__dirname, '../../prisma/schema.prisma');

interface RequiredConstraint {
  /** Audit / defect ID this constraint closes. */
  id: string;
  /** Name of the model that should contain the constraint. */
  model: string;
  /** Literal substring (within the model body) that must be present. */
  declaration: string;
  /** Why it exists, with reference to audit doc. */
  rationale: string;
}

const REQUIRED_CONSTRAINTS: ReadonlyArray<RequiredConstraint> = [
  {
    id: 'Tier-0 #5',
    model: 'ResourceMember',
    // SCIM identifies a member by its `value` sub-attribute (always populated).
    // Constraining (group, value) prevents duplicate memberships at the DB
    // level even if the service-layer dedup has a bug or a concurrent PATCH
    // races. memberResourceId is nullable (external members) so it is NOT a
    // suitable column for the constraint.
    declaration: '@@unique([groupResourceId, value])',
    rationale:
      'Prevents duplicate group memberships at DB level. Audit Tier-0 #5 in ' +
      'docs/DESIGN_IMPROVEMENT_DEEP_ANALYSIS.md and docs/DELIVERY_PLAN.md section 3.2.',
  },
];

async function readSchema(): Promise<string> {
  return fs.readFile(SCHEMA_PATH, 'utf8');
}

function extractModelBody(schema: string, modelName: string): string | null {
  const re = new RegExp(`model\\s+${modelName}\\s*\\{([\\s\\S]*?)\\n\\}`, 'm');
  const match = schema.match(re);
  return match ? match[1] : null;
}

describe('Schema constraint regression: Prisma schema.prisma', () => {
  it.each(REQUIRED_CONSTRAINTS.map(c => [c.id, c.model, c] as const))(
    '[%s] model %s declares the required constraint',
    async (_id, _model, constraint) => {
      const schema = await readSchema();
      const body = extractModelBody(schema, constraint.model);
      if (body === null) {
        throw new Error(
          `Required constraint [${constraint.id}] cannot be checked: ` +
            `model ${constraint.model} not found in schema.prisma. ` +
            `Did you rename or delete the model? Update REQUIRED_CONSTRAINTS.`,
        );
      }
      if (!body.includes(constraint.declaration)) {
        throw new Error(
          `Required constraint [${constraint.id}] missing from model ${constraint.model}.\n` +
            `Expected to find: ${constraint.declaration}\n` +
            `Rationale: ${constraint.rationale}\n` +
            `Add the declaration inside the model body and create a Prisma migration.`,
        );
      }
      expect(body).toContain(constraint.declaration);
    },
  );
});
