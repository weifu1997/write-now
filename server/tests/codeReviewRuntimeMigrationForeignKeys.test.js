const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");

const { applyMigration } = require("../dist/db/runtimeMigrations.js");

test("runtime migration keeps foreign_keys=OFF effective during table rebuild", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wf-review-mig-"));
  const migrationsDir = path.join(tmpDir, "migrations");
  const migrationName = "20260101000000_rebuild_parent";
  await fs.mkdir(path.join(migrationsDir, migrationName), { recursive: true });

  // 模拟桌面端升级时的真实场景：子表通过 ON DELETE CASCADE 引用父表，
  // 迁移以"建新表 → 拷贝 → DROP 旧表 → 改名"的方式重建父表。
  await fs.writeFile(
    path.join(migrationsDir, migrationName, "migration.sql"),
    [
      "PRAGMA foreign_keys=OFF;",
      "",
      'CREATE TABLE "new_Parent" (',
      '  "id" TEXT NOT NULL PRIMARY KEY,',
      '  "name" TEXT NOT NULL',
      ");",
      'INSERT INTO "new_Parent" ("id", "name") SELECT "id", "name" FROM "Parent";',
      'DROP TABLE "Parent";',
      'ALTER TABLE "new_Parent" RENAME TO "Parent";',
      "",
    ].join("\n"),
    "utf8",
  );

  const db = new Database(path.join(tmpDir, "test.db"));
  try {
    db.exec(`
      CREATE TABLE "_prisma_migrations" (
        id TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        finished_at TEXT,
        migration_name TEXT NOT NULL,
        logs TEXT,
        started_at TEXT NOT NULL,
        applied_steps_count INTEGER NOT NULL
      );
      CREATE TABLE "Parent" ("id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL);
      CREATE TABLE "Child" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "parentId" TEXT NOT NULL,
        CONSTRAINT "Child_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Parent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      );
      PRAGMA foreign_keys=ON;
    `);
    db.prepare(`INSERT INTO "Parent" ("id", "name") VALUES ('p1', 'parent')`).run();
    db.prepare(`INSERT INTO "Child" ("id", "parentId") VALUES ('c1', 'p1')`).run();

    applyMigration(db, migrationsDir, migrationName);

    // DROP TABLE 的隐式 DELETE 在 foreign_keys=OFF 时不得级联删除子表数据。
    const childCount = db.prepare(`SELECT COUNT(*) AS count FROM "Child"`).get().count;
    assert.equal(childCount, 1, `重建父表后子表数据被级联清空（PRAGMA foreign_keys 在事务内是空操作）`);

    const foreignKeysRestored = db.pragma("foreign_keys", { simple: true });
    assert.equal(foreignKeysRestored, 1, "迁移结束后应恢复连接原本的外键开关");
  } finally {
    db.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
