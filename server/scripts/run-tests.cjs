const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const serverRoot = path.resolve(__dirname, "..");
const testsRoot = path.join(serverRoot, "tests");

const integrationTests = new Set([
  "codeReviewCreativeHubStream.test.js",
  "directorTaskFactInspection.test.js",
  "directorWorkflowStepModules.test.js",
  "novelDirectorPipelineRuntime.test.js",
  "novelDirectorRetry.test.js",
  "novelWorkflowRuntime.test.js",
  "p0bRealPrismaChain.test.js",
  "prompting-governance.test.js",
  "prompting.test.js",
  "promptWorkbench.test.js",
  "ragCompatibilityBootstrap.test.js",
  "runtimeMigrations.test.js",
]);

function listTestFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return listTestFiles(fullPath);
      }
      return entry.isFile() && entry.name.endsWith(".test.js") ? [fullPath] : [];
    })
    .sort((left, right) => left.localeCompare(right));
}

function selectTestFiles(mode) {
  const allFiles = listTestFiles(testsRoot);
  if (mode === "integration") {
    return allFiles.filter((file) => integrationTests.has(path.basename(file)));
  }
  if (mode === "fast") {
    return allFiles.filter((file) => !integrationTests.has(path.basename(file)));
  }
  if (mode === "all") {
    return allFiles;
  }
  throw new Error(`Unknown test mode: ${mode}`);
}

const mode = process.argv[2] ?? "fast";
const files = selectTestFiles(mode);

if (files.length === 0) {
  console.error(`No tests selected for mode ${mode}.`);
  process.exit(1);
}

if (mode === "fast") {
  // 以编程式 API 在同一进程内顺序执行所有测试文件（与原 require 行为一致），
  // 结束后显式 process.exit：否则个别测试遗留的句柄（keep-alive socket、
  // 未关闭的 server）会让事件循环无法排空，套件跑完后进程挂住不退出。
  const { run } = require("node:test");

  (async () => {
    const runner = run({ files, isolation: "none", concurrency: 1 });
    let passCount = 0;
    let failCount = 0;
    const failureLines = [];
    runner.on("test:pass", () => {
      passCount += 1;
    });
    runner.on("test:fail", ({ name, details }) => {
      failCount += 1;
      failureLines.push(`✖ ${name}`);
      const message = details?.error?.message ?? details?.error;
      if (message) {
        failureLines.push(`    ${String(message).split("\n")[0]}`);
      }
    });
    runner.on("test:stderr", ({ message }) => {
      process.stderr.write(message);
    });

    await new Promise((resolve) => {
      runner.on("close", resolve);
      runner.on("end", resolve);
    });

    console.log(`\nℹ tests ${passCount + failCount} ℹ pass ${passCount} ℹ fail ${failCount}`);
    for (const line of failureLines) {
      console.error(line);
    }
    process.exit(failCount > 0 ? 1 : 0);
  })().catch((error) => {
    console.error(error);
    process.exit(1);
  });
  return;
}

const result = spawnSync(process.execPath, ["--test", ...files], {
  cwd: serverRoot,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
