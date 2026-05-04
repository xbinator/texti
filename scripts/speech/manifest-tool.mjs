/**
 * @file manifest-tool.mjs
 * @description 语音运行时 manifest 校验与 SHA256 生成工具。
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * 语音资源清单中的单个资源。
 * @typedef {object} SpeechManifestAsset
 * @property {string} name 资源名称。
 * @property {string} url 资源下载地址。
 * @property {string} sha256 资源的 SHA256 校验值。
 * @property {string} archiveType 资源分发类型。
 * @property {string} targetRelativePath 安装后的相对目标路径。
 */

/**
 * 单个平台的语音资源定义。
 * @typedef {object} SpeechManifestPlatformEntry
 * @property {string} platform 目标平台。
 * @property {string} arch 目标架构。
 * @property {string} version 当前平台资源版本。
 * @property {string} modelName 使用的模型名称。
 * @property {SpeechManifestAsset[]} assets 资源列表。
 */

/**
 * 语音运行时 manifest 的顶层结构。
 * @typedef {object} SpeechManifestDefinition
 * @property {string} currentVersion 当前默认资源版本。
 * @property {Record<string, SpeechManifestPlatformEntry>} platforms 平台资源映射。
 */

/**
 * fill 命令所需的参数集合。
 * @typedef {object} FillManifestOptions
 * @property {string} manifestPath 目标 manifest 路径。
 * @property {string} darwinArm64Path macOS arm64 whisper 二进制路径。
 * @property {string} darwinX64Path macOS x64 whisper 二进制路径。
 * @property {string} win32X64Path Windows x64 whisper 二进制路径。
 * @property {string} modelPath 模型文件路径。
 */

/**
 * 校验结果。
 * @typedef {object} ManifestValidationResult
 * @property {string[]} errors 结构错误集合。
 * @property {string[]} warnings 占位符或可疑配置集合。
 */

/**
 * 判断值是否为普通对象。
 * @param {unknown} value - 待判断的值。
 * @returns {value is Record<string, unknown>} 是否为普通对象。
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 判断字符串中是否仍然包含模板占位符。
 * @param {string} value - 待检查的字符串。
 * @returns {boolean} 是否包含占位符。
 */
function containsPlaceholder(value) {
  return value.includes('OWNER/REPO') || value.includes('REPLACE_WITH_');
}

/**
 * 读取并解析 JSON 文件。
 * @param {string} filePath - 目标 JSON 文件路径。
 * @returns {Promise<unknown>} 解析后的 JSON 值。
 */
export async function readJsonFile(filePath) {
  const jsonContent = await readFile(filePath, 'utf8');

  return JSON.parse(jsonContent);
}

/**
 * 计算文件的 SHA256 校验值。
 * @param {string} filePath - 目标文件路径。
 * @returns {Promise<string>} 十六进制 SHA256 字符串。
 */
export async function calculateFileSha256(filePath) {
  const fileContent = await readFile(filePath);
  const hash = createHash('sha256');

  hash.update(fileContent);

  return hash.digest('hex');
}

/**
 * 校验 manifest 中的单个资源定义。
 * @param {SpeechManifestAsset} asset - 资源定义。
 * @param {string} assetPath - 当前资源在 manifest 中的路径。
 * @param {ManifestValidationResult} result - 当前累计的校验结果。
 */
function validateAsset(asset, assetPath, result) {
  if (!isRecord(asset)) {
    result.errors.push(`${assetPath} 必须是对象`);
    return;
  }

  const { name, url, sha256, archiveType, targetRelativePath } = asset;

  if (typeof name !== 'string' || name.length === 0) {
    result.errors.push(`${assetPath}.name 必须是非空字符串`);
  }
  if (typeof url !== 'string' || url.length === 0) {
    result.errors.push(`${assetPath}.url 必须是非空字符串`);
  } else if (!url.startsWith('https://')) {
    result.errors.push(`${assetPath}.url 必须使用 https://`);
  } else if (containsPlaceholder(url)) {
    result.warnings.push(`${assetPath}.url 仍包含模板占位符`);
  }

  if (typeof sha256 !== 'string' || sha256.length === 0) {
    result.errors.push(`${assetPath}.sha256 必须是非空字符串`);
  } else if (!/^[a-f0-9]{64}$/u.test(sha256)) {
    if (containsPlaceholder(sha256)) {
      result.warnings.push(`${assetPath}.sha256 仍包含模板占位符`);
    } else {
      result.errors.push(`${assetPath}.sha256 必须是 64 位十六进制字符串`);
    }
  }

  if (typeof archiveType !== 'string' || archiveType.length === 0) {
    result.errors.push(`${assetPath}.archiveType 必须是非空字符串`);
  }
  if (typeof targetRelativePath !== 'string' || targetRelativePath.length === 0) {
    result.errors.push(`${assetPath}.targetRelativePath 必须是非空字符串`);
  } else if (targetRelativePath.startsWith('/')) {
    result.errors.push(`${assetPath}.targetRelativePath 必须是相对路径`);
  }
}

/**
 * 校验 manifest 的结构与关键字段。
 * @param {unknown} definition - 待校验的 manifest 内容。
 * @returns {ManifestValidationResult} 校验结果。
 */
export function validateManifestDefinition(definition) {
  /** @type {ManifestValidationResult} */
  const result = { errors: [], warnings: [] };

  if (!isRecord(definition)) {
    result.errors.push('manifest 顶层必须是对象');
    return result;
  }

  const { currentVersion, platforms } = definition;

  if (typeof currentVersion !== 'string' || currentVersion.length === 0) {
    result.errors.push('currentVersion 必须是非空字符串');
  }
  if (!isRecord(platforms)) {
    result.errors.push('platforms 必须是对象');
    return result;
  }

  for (const [platformKey, platformDefinition] of Object.entries(platforms)) {
    const platformPath = `platforms.${platformKey}`;

    if (!isRecord(platformDefinition)) {
      result.errors.push(`${platformPath} 必须是对象`);
      continue;
    }

    const { platform, arch, version, modelName, assets } = platformDefinition;

    if (typeof platform !== 'string' || platform.length === 0) {
      result.errors.push(`${platformPath}.platform 必须是非空字符串`);
    }
    if (typeof arch !== 'string' || arch.length === 0) {
      result.errors.push(`${platformPath}.arch 必须是非空字符串`);
    }
    if (typeof version !== 'string' || version.length === 0) {
      result.errors.push(`${platformPath}.version 必须是非空字符串`);
    }
    if (typeof modelName !== 'string' || modelName.length === 0) {
      result.errors.push(`${platformPath}.modelName 必须是非空字符串`);
    }
    if (!Array.isArray(assets) || assets.length === 0) {
      result.errors.push(`${platformPath}.assets 必须是非空数组`);
      continue;
    }

    assets.forEach((asset, assetIndex) => {
      validateAsset(/** @type {SpeechManifestAsset} */ (asset), `${platformPath}.assets[${assetIndex}]`, result);
    });
  }

  return result;
}

/**
 * 打印脚本帮助信息。
 * @returns {void}
 */
function printHelp() {
  console.log('Usage:');
  console.log('  node scripts/speech/manifest-tool.mjs hash <file...>');
  console.log('  node scripts/speech/manifest-tool.mjs validate [manifestPath]');
  console.log('  node scripts/speech/manifest-tool.mjs fill --darwin-arm64 <file> --darwin-x64 <file> --win32-x64 <file> --model <file> [--manifest <file>]');
}

/**
 * 将命令行参数解析为按键值组织的简单映射。
 * @param {string[]} argumentsList - 待解析的参数列表。
 * @returns {Map<string, string>} 解析后的参数映射。
 */
function parseNamedArguments(argumentsList) {
  const namedArguments = new Map();
  const normalizedArguments = argumentsList.filter((argument) => argument !== '--');

  for (let index = 0; index < normalizedArguments.length; index += 2) {
    const optionName = normalizedArguments[index];
    const optionValue = normalizedArguments[index + 1];

    if (!optionName?.startsWith('--') || !optionValue) {
      continue;
    }

    namedArguments.set(optionName, optionValue);
  }

  return namedArguments;
}

/**
 * 按约定更新 manifest 中对应资源的 SHA256。
 * @param {SpeechManifestDefinition} manifestDefinition - 待更新的 manifest 对象。
 * @param {Record<string, string>} digests - 资源到 SHA256 的映射。
 * @returns {SpeechManifestDefinition} 更新后的 manifest 对象。
 */
export function applyDigestsToManifest(manifestDefinition, digests) {
  const clonedDefinition = /** @type {SpeechManifestDefinition} */ (structuredClone(manifestDefinition));
  const platformMappings = [
    { platformKey: 'darwin-arm64', assetName: 'whisper', digestKey: 'darwinArm64' },
    { platformKey: 'darwin-x64', assetName: 'whisper', digestKey: 'darwinX64' },
    { platformKey: 'win32-x64', assetName: 'whisper', digestKey: 'win32X64' }
  ];

  platformMappings.forEach(({ platformKey, assetName, digestKey }) => {
    const targetAsset = clonedDefinition.platforms[platformKey]?.assets.find((asset) => asset.name === assetName);

    if (targetAsset) {
      targetAsset.sha256 = digests[digestKey];
    }
  });

  Object.values(clonedDefinition.platforms).forEach((platformDefinition) => {
    const modelAsset = platformDefinition.assets.find((asset) => asset.name === 'model');

    if (modelAsset) {
      modelAsset.sha256 = digests.model;
    }
  });

  return clonedDefinition;
}

/**
 * 校验 fill 命令的参数是否齐全。
 * @param {Map<string, string>} namedArguments - 已解析的命令行参数。
 * @returns {FillManifestOptions | null} 齐全时返回参数对象，否则返回 null。
 */
function parseFillOptions(namedArguments) {
  const manifestPath = namedArguments.get('--manifest') ?? 'resources/speech/manifest.json';
  const darwinArm64Path = namedArguments.get('--darwin-arm64');
  const darwinX64Path = namedArguments.get('--darwin-x64');
  const win32X64Path = namedArguments.get('--win32-x64');
  const modelPath = namedArguments.get('--model');

  if (!darwinArm64Path || !darwinX64Path || !win32X64Path || !modelPath) {
    return null;
  }

  return {
    manifestPath,
    darwinArm64Path,
    darwinX64Path,
    win32X64Path,
    modelPath
  };
}

/**
 * 以人类可读方式输出 hash 结果。
 * @param {string[]} filePaths - 待计算哈希的文件路径集合。
 * @returns {Promise<number>} 进程退出码。
 */
export async function runHashCommand(filePaths) {
  const normalizedFilePaths = filePaths.filter((filePath) => filePath !== '--');

  if (normalizedFilePaths.length === 0) {
    console.error('请至少提供一个文件路径用于计算 SHA256');
    return 1;
  }

  const digestEntries = await Promise.all(
    normalizedFilePaths.map(async (filePath) => {
      const absoluteFilePath = resolve(process.cwd(), filePath);
      const digest = await calculateFileSha256(absoluteFilePath);

      return { filePath, digest };
    })
  );

  digestEntries.forEach(({ filePath, digest }) => {
    console.log(`${filePath} ${digest}`);
  });

  return 0;
}

/**
 * 读取并校验 manifest 文件。
 * @param {string | undefined} manifestPath - manifest 文件路径，未传时使用默认路径。
 * @returns {Promise<number>} 进程退出码。
 */
export async function runValidateCommand(manifestPath) {
  const resolvedManifestPath = resolve(process.cwd(), manifestPath && manifestPath !== '--' ? manifestPath : 'resources/speech/manifest.json');
  const manifestContent = await readJsonFile(resolvedManifestPath);
  const validationResult = validateManifestDefinition(manifestContent);

  if (validationResult.errors.length > 0) {
    console.error(`manifest 校验失败: ${resolvedManifestPath}`);
    validationResult.errors.forEach((errorMessage) => {
      console.error(`- ${errorMessage}`);
    });
    validationResult.warnings.forEach((warningMessage) => {
      console.error(`! ${warningMessage}`);
    });
    return 1;
  }

  console.log(`manifest 校验通过: ${resolvedManifestPath}`);
  validationResult.warnings.forEach((warningMessage) => {
    console.warn(`! ${warningMessage}`);
  });

  return 0;
}

/**
 * 读取本地资源文件并自动回填 manifest 中的 SHA256。
 * @param {FillManifestOptions} options - fill 命令参数。
 * @returns {Promise<number>} 进程退出码。
 */
export async function runFillCommand(options) {
  const resolvedManifestPath = resolve(process.cwd(), options.manifestPath);
  const manifestContent = /** @type {SpeechManifestDefinition} */ (await readJsonFile(resolvedManifestPath));
  const digestEntries = await Promise.all([
    calculateFileSha256(resolve(process.cwd(), options.darwinArm64Path)),
    calculateFileSha256(resolve(process.cwd(), options.darwinX64Path)),
    calculateFileSha256(resolve(process.cwd(), options.win32X64Path)),
    calculateFileSha256(resolve(process.cwd(), options.modelPath))
  ]);
  const nextManifest = applyDigestsToManifest(manifestContent, {
    darwinArm64: digestEntries[0],
    darwinX64: digestEntries[1],
    win32X64: digestEntries[2],
    model: digestEntries[3]
  });

  await writeFile(resolvedManifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, 'utf8');

  console.log(`manifest 已回填 SHA256: ${resolvedManifestPath}`);

  return runValidateCommand(resolvedManifestPath);
}

/**
 * 脚本主入口。
 * @param {string[]} argv - 传入的命令行参数。
 * @returns {Promise<number>} 进程退出码。
 */
export async function runCli(argv) {
  const normalizedArguments = argv[0] === '--' ? argv.slice(1) : argv;
  const [command, ...argumentsList] = normalizedArguments;

  if (!command || command === '--help' || command === '-h') {
    printHelp();
    return 0;
  }

  if (command === 'hash') {
    return runHashCommand(argumentsList);
  }

  if (command === 'validate') {
    return runValidateCommand(argumentsList[0]);
  }

  if (command === 'fill') {
    const namedArguments = parseNamedArguments(argumentsList);
    const fillOptions = parseFillOptions(namedArguments);

    if (!fillOptions) {
      console.error('fill 命令需要提供 --darwin-arm64、--darwin-x64、--win32-x64、--model 参数');
      printHelp();
      return 1;
    }

    return runFillCommand(fillOptions);
  }

  console.error(`未知命令: ${command}`);
  printHelp();
  return 1;
}

/**
 * 仅在直接通过 Node 执行时触发 CLI。
 */
if (import.meta.url === new URL(process.argv[1], 'file://').href) {
  runCli(process.argv.slice(2))
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      const errorMessage = error instanceof Error ? error.stack ?? error.message : String(error);

      console.error(errorMessage);
      process.exitCode = 1;
    });
}
