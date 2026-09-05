import path from "node:path";

import { resolveGeneratedImagesRoot } from "../../runtime/appPaths";

/** 漫画静态资源的合法一级子目录 */
const COMIC_STORAGE_SUBDIRS = new Set([
  "comic-panels",
  "comic-panels-lettered",
  "comic-exports",
]);

/**
 * 漫画静态资源统一存放在 generated-images 根目录对应的子目录之下。
 * 所有拼接了请求侧 id（jobId / panelId）的路径必须经过这里解析：
 * Express 会先对路径参数做百分号解码再交给路由，`..%2F` 形式的越界 id
 * 会在 join 后逃出资源目录，因此这里用归一化后的相对路径做包含性校验。
 *
 * 返回 null 表示请求侧 id 越界，调用方应按"资源不存在"处理，禁止任何文件读写。
 */
export function resolveComicStoragePath(subdir: string, ...rest: string[]): string | null {
  if (!COMIC_STORAGE_SUBDIRS.has(subdir)) {
    return null;
  }
  const baseDir = path.resolve(resolveGeneratedImagesRoot(), subdir);
  const resolved = path.resolve(baseDir, ...rest);
  const relative = path.relative(baseDir, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  return resolved;
}
