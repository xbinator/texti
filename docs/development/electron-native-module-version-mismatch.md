# Electron 原生模块版本不匹配问题

## 问题现象

启动 Electron 项目时出现以下错误：

```
Error: The module '...\better-sqlite3\build\Release\better_sqlite3.node'
was compiled against a different Node.js version using
NODE_MODULE_VERSION 137. This version of Node.js requires
NODE_MODULE_VERSION 145. Please try re-compiling or re-installing
the module (for instance, using `npm rebuild` or `npm install`).
```

## 问题原因

### 根本原因

**原生 Node.js 模块版本不匹配**

1. **原生模块特性**：
   - `better-sqlite3` 是一个原生 C++ 模块，需要针对特定的 Node.js 版本编译
   - 编译时会生成 `.node` 二进制文件，包含 `NODE_MODULE_VERSION` 标识

2. **Electron 的特殊性**：
   - Electron 内置了自己的 Node.js 运行时
   - Electron 版本更新时，内置的 Node.js 版本也会变化
   - 不同的 Node.js 版本有不同的 `NODE_MODULE_VERSION`

3. **版本对应关系**：
   - `NODE_MODULE_VERSION 137`：对应旧版本的 Node.js
   - `NODE_MODULE_VERSION 145`：对应 Electron v41.3.0 内置的 Node.js 版本

### 为什么会发生

1. **依赖安装时机问题**：
   - 原生模块在 `pnpm install` 时编译
   - 如果 Electron 版本更新后没有重新编译原生模块，就会出现版本不匹配

2. **postinstall 脚本未执行**：
   - 项目配置了 `postinstall` 脚本运行 `electron-rebuild`
   - 但某些情况下（如 lockfile 存在时）postinstall 可能不会执行

## 解决方案

### 方案一：手动重新编译（推荐）

使用 `electron-rebuild` 重新编译原生模块：

```bash
# 使用 pnpm
pnpm exec electron-rebuild -f -w better-sqlite3

# 或使用 npx
npx @electron/rebuild -f -w better-sqlite3
```

参数说明：
- `-f`：强制重新编译
- `-w`：指定要编译的模块名称

### 方案二：重新安装依赖

删除 `node_modules` 并重新安装：

```bash
# 删除依赖
rm -rf node_modules

# 重新安装（会自动运行 postinstall）
pnpm install
```

### 方案三：手动触发 postinstall

```bash
pnpm run postinstall
```

## 预防措施

### 1. 配置 package.json

确保 `package.json` 中配置了 `postinstall` 脚本：

```json
{
  "scripts": {
    "postinstall": "electron-rebuild"
  }
}
```

### 2. 配置 pnpm 只构建原生模块

在 `package.json` 中添加：

```json
{
  "pnpm": {
    "onlyBuiltDependencies": [
      "electron",
      "better-sqlite3"
    ]
  }
}
```

这样可以确保 pnpm 只构建必要的原生模块，提高安装速度。

### 3. Electron 版本更新后

当 Electron 版本更新后，务必重新编译原生模块：

```bash
pnpm exec electron-rebuild
```

## 常见问题

### Q1: 为什么 `pnpm install` 后还是报错？

**A**: 可能是因为：
1. lockfile 存在，跳过了 postinstall 脚本
2. pnpm 的缓存导致没有重新编译
3. 需要使用 `--force` 参数强制重新安装

### Q2: 如何查看 Electron 的 Node.js 版本？

**A**: 运行以下命令：

```bash
npx electron --version
```

然后在 [Electron Releases](https://www.electronjs.org/releases/stable) 页面查看对应的 Node.js 版本。

### Q3: 如何查看 NODE_MODULE_VERSION？

**A**: 在 Node.js 或 Electron 中运行：

```javascript
console.log(process.versions.modules);
```

### Q4: 端口被占用怎么办？

**A**: 如果端口 1420 被占用，可以：

1. 查找并结束占用进程：
```bash
# Windows
netstat -ano | findstr :1420
taskkill /F /PID <PID>

# Linux/macOS
lsof -i :1420
kill -9 <PID>
```

2. 或修改 `.env` 文件中的端口配置：
```
DEV_SERVER_PORT=1421
```

## 相关资源

- [Electron Documentation - Using Native Node Modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)
- [electron-rebuild GitHub](https://github.com/electron/rebuild)
- [better-sqlite3 Documentation](https://github.com/WiseLibs/better-sqlite3)
- [Node.js NODE_MODULE_VERSION](https://nodejs.org/en/download/releases/)

## 总结

Electron 原生模块版本不匹配是一个常见问题，主要原因是：

1. **原生模块需要针对特定 Node.js 版本编译**
2. **Electron 内置的 Node.js 版本与系统不同**
3. **依赖更新后未重新编译原生模块**

解决方案很简单：**使用 `electron-rebuild` 重新编译原生模块**。

记住：**每次 Electron 版本更新后，都需要重新编译原生模块！**
