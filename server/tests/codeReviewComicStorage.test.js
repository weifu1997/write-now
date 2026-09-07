const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");

const { comicExportService } = require("../dist/services/comic/ComicExportService.js");
const { comicPanelImageService } = require("../dist/services/comic/ComicPanelImageService.js");
const { comicBubbleLayoutService } = require("../dist/services/comic/ComicBubbleLayoutService.js");
const { comicSpriteSheetService } = require("../dist/services/comic/ComicSpriteSheetService.js");
const { resolveGeneratedImagesRoot } = require("../dist/runtime/appPaths.js");

async function writeMarkerFile(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
}

test("comic export artifact lookup must not escape the export job directory", async () => {
  const storageRoot = resolveGeneratedImagesRoot();
  const markerPath = path.join(storageRoot, "..", "wf-review-escape-marker.txt");
  await writeMarkerFile(markerPath, "top-secret-marker");

  try {
    // jobId="../../" 经 path.join 后指向 generated-images 根目录的上一级。
    const file = await comicExportService.getArtifactFile("../../", "wf-review-escape-marker.txt");
    assert.equal(file, null, "jobId 越出导出目录时必须按 404 处理，而不是读取越界文件");
  } finally {
    await fs.rm(markerPath, { force: true });
  }
});

test("comic panel image lookup must not escape the panel directory", async () => {
  const storageRoot = resolveGeneratedImagesRoot();
  const smuggledDir = path.join(storageRoot, "wf-review-smuggled");
  await writeMarkerFile(path.join(smuggledDir, "panel.png"), "png-marker");

  try {
    // panelId="../wf-review-smuggled" 越出 comic-panels 目录。
    const file = await comicPanelImageService.getPanelImageFile("../wf-review-smuggled");
    assert.equal(file, null, "panelId 越出面板目录时必须按 404 处理");
  } finally {
    await fs.rm(smuggledDir, { recursive: true, force: true });
  }
});

test("comic lettered panel lookup must not escape the lettered directory", async () => {
  const storageRoot = resolveGeneratedImagesRoot();
  const smuggledDir = path.join(storageRoot, "wf-review-smuggled-lettered");
  await writeMarkerFile(path.join(smuggledDir, "lettered.png"), "lettered-marker");

  try {
    const file = await comicBubbleLayoutService.getLetteredImageFile("../wf-review-smuggled-lettered");
    assert.equal(file, null, "panelId 越出排版目录时必须按 404 处理");
  } finally {
    await fs.rm(smuggledDir, { recursive: true, force: true });
  }
});

test("sprite sheet column width follows the source aspect ratio", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wf-review-sprite-"));
  const sourcePath = path.join(tmpDir, "sheet.png");
  // 非正方形原图：200x100，按 TARGET_HEIGHT=512 等比放大后宽度应为 1024。
  await sharp({
    create: { width: 200, height: 100, channels: 3, background: { r: 120, g: 120, b: 200 } },
  }).png().toFile(sourcePath);

  try {
    const result = await comicSpriteSheetService.buildSpriteSheet({
      characterName: "测试角色",
      sheetFilePath: sourcePath,
      costumeAssets: [],
      propAssets: [],
    });
    assert.ok(result, "200x100 原图应能生成雪碧图列（当前实现因画布宽度错误导致合成失败）");
    const meta = await sharp(result.filePath).metadata();
    assert.equal(meta.width, 1024, `雪碧图列宽度应为 1024，实际为 ${meta.width}`);
    assert.equal(meta.height, 540); // TARGET_HEIGHT(512) + LABEL_HEIGHT(28)
    await result.cleanup();
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
