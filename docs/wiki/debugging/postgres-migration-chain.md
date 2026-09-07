# Postgres 迁移链失败模式与修复记录

## 背景

本项目同时维护两套 Prisma 迁移：`server/src/prisma/migrations/`（PostgreSQL）与 `server/src/prisma/migrations.sqlite/`（SQLite）。2026-09 的 Docker 整栈部署验证发现：Postgres 迁移链在**全新数据库**上从未走通过——此前 Postgres 库都靠 `prisma db push` 直接推平 schema，掩盖了迁移文件本身的问题。以下失败模式在 2026-09-05 全部修复，修复标准是"全新库上 `prisma migrate deploy` 一次通过"。

## 失败模式（均已修复）

### 1. SQLite 类型泄漏进 Postgres 迁移

`DATETIME` 是 SQLite 类型，Postgres 报 `type "datetime" does not exist`（42704）。由 sqlite 迁移文件被直接复制进 postgres 目录导致。修复：统一替换为 Prisma Postgres 约定的 `TIMESTAMP(3)`；同理 `REAL` 应为 `DOUBLE PRECISION`（对应 schema.prisma 的 `Float`）。

**规则**：向 postgres 迁移目录新增文件时，禁止从 sqlite 目录复制 SQL 原文；时间列一律 `TIMESTAMP(3)`，浮点一律 `DOUBLE PRECISION`。

### 2. 迁移链顺序错误：基线快照晚于引用它的迁移

`20260328120000_schema_gap_backfill`（后改由它之前执行）通过外键引用 `Novel` 等基表，而创建基表的 `20260413120000_postgresql_baseline` 按文件名排序排在它**之后**，全新库上一开场就报 `relation "Novel" does not exist`（42P01）。修复：基线改名为 `20260327000000_postgresql_baseline`，保证排序第一。

**规则**：Postgres 迁移按目录名字典序执行；新增"补历史差异"类 backfill 迁移时，必须确认它引用的所有对象在排序上先于它存在，或其语句全部幂等（`IF NOT EXISTS`）。

### 3. 迁移语句非幂等，重复或与基线冲突

多份 backfill/重复迁移用普通 `ADD COLUMN`、`CREATE TABLE`、`CREATE INDEX`，在基线已含同名列/表，或同一迁移出现两个版本（如 `style_extraction_task` 4月21/22日两个文件）时，报 `already exists`（42701/42P07）。修复原则：

- 同名迁移对：保留正确的一份内容，另一份全部语句幂等化（`ADD COLUMN IF NOT EXISTS`、`CREATE TABLE IF NOT EXISTS`、`CREATE INDEX IF NOT EXISTS`）；
- 与基线重叠的 backfill：一律 `IF NOT EXISTS`。

### 4. 索引名超过 Postgres 63 字符上限后截断碰撞

`BookAnalysisCharacterAppearanceSnapshot` 表名过长，schema 同时声明 `@@unique([characterId, chapterIndex])` 与同列 `@@index`，两者生成的索引名截断后同名，迁移报 `relation ... already exists`。修复：删除冗余的同列普通索引（唯一索引已覆盖其查询能力），schema.prisma 与迁移文件同步删除。

**规则**：为长表名模型同时声明内容相同的 `@@unique` 与 `@@index` 时，Postgres 下必冲突；普通索引能被唯一索引覆盖的就不要声明。

### 5. 被幂等跳过的 backfill 造成"链终态 ≠ schema"的结构缺口

基线快照创建的表（如 `NovelWorkflowTask`）在日期更早、内容更全的 gap backfill 中以 `CREATE TABLE IF NOT EXISTS` 出现，执行时被整体跳过，backfill 里的列/表（如 `pendingManualRecovery`、`PromptSlotOverride`、`ComicScene`）从此没有任何迁移补齐。运行期表现为 Prisma 报 `The column (not available) does not exist`（where 条件引用了不存在的列）。2026-09-05 通过对账迁移 `20260906000000_postgres_schema_reconcile` 一次性收敛：缺失表/列、多余外键、默认值漂移、截断索引名。

**规则**：
- 判断迁移链是否健康的唯一标准是链终态等于 `schema.prisma`，而不是"每条迁移都成功"。验证命令：`prisma migrate diff --from-config-datasource --to-schema src/prisma/schema.prisma --exit-code`（退出码 0 = 收敛）。
- 为存量结构写收敛迁移时，文件名日期排到最后，且所有语句必须幂等（`IF NOT EXISTS` / `DROP ... IF EXISTS` / `ADD CONSTRAINT` 用 `DO $$ ... EXCEPTION duplicate_object` 包裹）。
- 新增模型或列时，必须同步新增日期递增的 Postgres 迁移；禁止依赖"更新某个旧 backfill 文件"来表达结构变更。

## 现行部署契约

- 容器部署入口 `infra/docker/api-entrypoint.sh` 在启动前执行 `prisma migrate deploy`；迁移失败容器立即退出并由 compose 重启策略重试。
- `migrate deploy` 按迁移名跳过已应用记录，不校验 checksum，也不执行已回滚（rolled-back）记录——修改已应用迁移的 SQL 对存量库是安全的，但改动只影响全新库。
- 验证迁移链的正确姿势：`docker compose -f infra/docker-compose.yml down -v && up -d db`，再用任意能连到 `db:5432` 的环境跑 `prisma migrate deploy`，看到 `All migrations have been successfully applied` 才算通过；只跑 `db push` 验证不出这类问题。

## 相关模块

- `server/src/prisma/migrations/`（Postgres 迁移链）
- `server/src/db/runtimeMigrations.ts`（仅 desktop+sqlite 的运行时迁移，与 Postgres 链无关）
- `infra/docker-compose.yml`、`infra/docker/api-entrypoint.sh`（容器部署）
