# Docker 部署指南

本文描述如何用 Docker 把「AI 小说写作助手」整栈跑起来：Web 前端、API 服务、PostgreSQL 数据库（可选 Qdrant 向量库）。适合在一台服务器或本机上完成首次部署与日常升级。

## 前置要求

- Docker 20.10+ 与 Docker Compose v2（`docker compose version` 可用即可）。
- 构建过程需要访问网络下载依赖。

## 快速启动

在仓库根目录执行：

```bash
docker compose -f infra/docker-compose.yml up -d --build
```

首次构建约需几分钟到十几分钟。完成后：

- 打开 **http://localhost:8080** 即可使用产品；
- API 通过 Web 的 `/api` 反向代理访问，无需单独暴露；`127.0.0.1:3000` 仅用于本机调试。

首次启动时，API 容器会自动执行数据库迁移，日志中出现 `All migrations have been successfully applied` 后服务即可正常使用。

## 服务与端口

| 服务 | 说明 | 端口 |
| --- | --- | --- |
| web | Nginx 托管前端静态资源，并反代 `/api` | `8080`（对外开放） |
| api | Node.js 后端，启动时自动执行数据库迁移 | `127.0.0.1:3000`（仅本机调试） |
| db | PostgreSQL 16 数据库 | 仅容器网络内 |
| qdrant | 可选的向量检索服务（见下文） | `127.0.0.1:6333/6334`（仅本机） |

默认数据库账号密码为 `ai_novel` / `ai_novel`，写在 `infra/docker-compose.yml` 中。如果服务暴露到公网或不可信网络，请先修改密码（`db` 服务的 `POSTGRES_PASSWORD` 与 `api` 服务的 `DATABASE_URL` 需同步修改；已有数据时还需进库改密码，详见常见问题）。

## 数据存放与备份

所有持久化数据都在 Docker 命名卷中：

- `ai-novel_postgres_data`：数据库全部数据（小说、章节、设置、模型密钥等）。
- `ai-novel_api_storage`：生成的图片等本地文件。

备份示例：

```bash
docker compose -f infra/docker-compose.yml exec db \
  pg_dump -U ai_novel ai_novel > backup-$(date +%F).sql
docker run --rm -v ai-novel_api_storage:/data -v "$PWD":/backup alpine \
  tar czf /backup/api-storage-$(date +%F).tgz -C /data .
```

## 启用向量检索（RAG）

知识库的向量检索依赖 Qdrant，默认不启动。需要时：

1. `docker compose -f infra/docker-compose.yml --profile qdrant up -d`
2. 在 `infra/docker-compose.yml` 的 `api` 服务中取消 `QDRANT_URL: http://qdrant:6333` 的注释，然后 `docker compose -f infra/docker-compose.yml --profile qdrant up -d api` 重建 api。
3. Embedding 模型的 Provider 与密钥在产品「知识库 / 设置」页面配置。

不启用 Qdrant 时，产品的其余功能不受影响。

## 日常升级

```bash
git pull
docker compose -f infra/docker-compose.yml build
docker compose -f infra/docker-compose.yml up -d
```

数据库结构变更会在 API 容器启动时自动迁移，无需手动操作。升级前建议先做一次数据备份。

## 常见问题

**端口被占用**：8080 或 3000 被其他程序占用时，在 `infra/docker-compose.yml` 的 `ports` 中改映射，例如 `"8081:8080"`，然后用新端口访问。

**查看运行状态 / 日志**：

```bash
docker compose -f infra/docker-compose.yml ps
docker compose -f infra/docker-compose.yml logs -f api
```

**迁移失败 / API 反复重启**：通常是数据库未就绪或 `DATABASE_URL` 配置错误，先看 `db` 服务是否 healthy，再看 `logs api` 中的具体报错；修复后容器会自动重试。

**修改了数据库密码但已有数据**：除改 compose 配置外，需要进入数据库执行 `ALTER USER ai_novel WITH PASSWORD '新密码';`，保持三者一致。

**在别的机器/局域网访问**：浏览器直接访问部署机的 8080 端口即可（前端与 API 同源走反代，无需额外跨域配置）。
