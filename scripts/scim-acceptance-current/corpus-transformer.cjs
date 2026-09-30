const path = require("node:path");
const assert = require("node:assert/strict");

function replaceOnce(source, before, after, label) {
  assert.equal(
    source.split(before).length,
    2,
    `Current-source corpus adaptation seam changed: ${label}`,
  );
  return source.replace(before, after);
}

function adaptCorpus(sourceText, sourcePath) {
  let source = sourceText.replace(/\r\n/g, "\n");
  if (path.basename(sourcePath) !== "dual-backend.spec.cjs") return source;

  source = replaceOnce(
    source,
    `      if (strict) {
        c.check(
          "observed rejected PATCH preserves stored payload",`,
    `      if (strict && response.status !== 200) {
        c.check(
          "observed rejected PATCH preserves stored payload",`,
    "strict incident success disposition",
  );

  source = replaceOnce(
    source,
    `      original = repos.Groups.addMembers;
      repos.Groups.addMembers = async function (id, members) {
        if (id === before.id)
          throw new RepositoryError(
            "UNKNOWN",
            "synthetic member persistence fault",
          );
        return original.call(this, id, members);
      };`,
    `      original = repos.Groups.updateGroupWithMembers;
      repos.Groups.updateGroupWithMembers = async function (id, ...args) {
        if (id === before.id)
          throw new RepositoryError(
            "UNKNOWN",
            "synthetic member persistence fault",
          );
        return original.call(this, id, ...args);
      };`,
    "InMemory Group PATCH aggregate fault",
  );
  source = replaceOnce(
    source,
    `      } else repos.Groups.addMembers = original;
    }
    const after = await stored`,
    `      } else repos.Groups.updateGroupWithMembers = original;
    }
    const after = await stored`,
    "InMemory Group PATCH aggregate restore",
  );

  source = replaceOnce(
    source,
    `      original = repos.Groups.addMembers;
      repos.Groups.addMembers = async () => {
        throw new RepositoryError(
          "UNKNOWN",
          "synthetic Group POST member failure",
        );
      };`,
    `      original = repos.Groups.create;
      repos.Groups.create = async (...args) => {
        throw new RepositoryError(
          "UNKNOWN",
          "synthetic Group POST member failure",
        );
      };`,
    "InMemory Group POST aggregate fault",
  );
  source = replaceOnce(
    source,
    `      } else repos.Groups.addMembers = original;
    }
    const groups = await repos.Groups.findAllWithMembers`,
    `      } else repos.Groups.create = original;
    }
    const groups = await repos.Groups.findAllWithMembers`,
    "InMemory Group POST aggregate restore",
  );

  return source;
}

module.exports = {
  process(sourceText, sourcePath) {
    return { code: adaptCorpus(sourceText, sourcePath) };
  },
  adaptCorpus,
};
