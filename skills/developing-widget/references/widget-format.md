# Widget 格式参考

使用本参考确认包目录结构、`widget.json`、schema、导入限制和校验规则。

## 目录

- [包目录结构](#包目录结构)
- [安装位置](#安装位置)
- [顶层 WidgetData](#顶层-widgetdata)
- [Schemas](#schemas)
- [Execute](#execute)
- [Metadata](#metadata)
- [校验](#校验)

## 包目录结构

生成的 Widget 包应该是一个目录：

```text
my-widget/
  widget.json
  assets/
    optional-file.png
```

本地扫描器只会发现 `~/.tibis/widgets/<widget-id>/widget.json` 下的 Widget；目录名会作为稳定的本地 Widget ID。除非用户明确要求安装，否则不要写入该扫描目录。

导入器接受单个 JSON 文件，或根目录包含 `widget.json` 的 ZIP 包。ZIP 包最多包含 50 个非目录文件，`widget.json` 之外的每个资源文件最大 5 MiB。所有路径都必须留在包目录内部。

## 安装位置

当用户要求安装或持久化 Widget 时，运行时扫描根目录是 `~/.tibis/widgets/`。路径中的复数目录段 `widgets/` 是强制要求，扫描器只监听 `.tibis/` 下的这个子目录。

唯一正确的安装文件路径：

```text
~/.tibis/widgets/<widget-id>/widget.json
```

规则：

- `<widget-id>` 是创建弹窗里的“小组件标识”，也是 `WidgetDefinition.id`，必须与目录名一致。它不是 `widget.json.name` 显示名；只有当 `name` 本身已符合 `[a-z0-9_-]` 时，才可以让标识与名称相同。
- `<widget-id>` 允许字符为 `[a-z0-9_-]`；大小写混用、空格和斜杠会被安装器的路径安全检查拒绝。
- 必须把 `widget.json` 和导入资源写入 `<widget-id>/` 目录中，不要直接写入 `.tibis/`。
- 写入前检查最终路径：它必须位于 `.tibis/widgets/` 扫描根目录下，并且文件名必须是 `widget.json`。
- 不要在计划、输出或脚本中复述错误完整路径；只使用上面的唯一正确路径。
- 如果用户没有明确要求安装，应在其他位置生成 Widget 包目录（例如当前 workspace），让用户以 JSON 或 ZIP 方式导入。设置页的 Widgets 区域提供“创建小组件”按钮，会使用 `reject` 冲突策略调用官方安装器。

这条规则存在是因为扫描根目录是硬编码的；任何不在该根目录下的 Widget 都对应用不可见。

## 顶层 WidgetData

`widget.json` 必须包含一个如下结构的 JSON 对象：

```json
{
  "name": "weather-card",
  "description": "Show current weather for a city.",
  "inputSchema": { "type": "object", "properties": {}, "required": [] },
  "outputSchema": { "type": "object", "properties": {}, "required": [] },
  "dataSchema": { "type": "object", "properties": {}, "required": [] },
  "execute": {
    "enabled": true,
    "description": "Fetch and prepare weather data.",
    "code": "export default class WeatherCard extends Widget {\n  async onExecute() {\n    return {}\n  }\n}\n"
  },
  "metadata": { "width": 360, "height": 240 },
  "elements": []
}
```

除非源类型本身更新，否则不要新增顶层字段。

## Schemas

`inputSchema`、`outputSchema`、`dataSchema` 都是对象 schema：

```json
{
  "type": "object",
  "description": "Optional schema description.",
  "properties": {
    "city": {
      "type": "string",
      "description": "City name."
    }
  },
  "required": ["city"]
}
```

`type` 字段支持的取值为 `string`、`number`、`boolean`、`object`、`array`。`object` 类型可嵌套 `properties` 与 `required`；`array` 类型可包含 `items`。

schema 同时是绑定的契约：

- `$input.foo` 必须在 `inputSchema.properties` 中声明。
- `$output.foo` 必须在 `outputSchema.properties` 中声明。
- 裸运行时数据绑定（如 `{{ temperature }}`）必须在 `dataSchema.properties` 中声明。

## Execute

`execute.code` 是 JavaScript 文本，应默认导出一个继承 `Widget` 的类：

```js
export default class WeatherCard extends Widget {
  async onExecute() {
    return {}
  }
}
```

编写生命周期代码、按钮方法、HTTP 请求、消息或 logger 调用前，先阅读 `references/runtime-api.md`。

## Metadata

顶层 `metadata` 是一个对象。`metadata.width` 与 `metadata.height` 是可选的正数，供校验器做元素边界检查使用。

## 校验

执行：

```bash
node ../scripts/validate-widget.js <widget-directory>
```

校验器会检查：JSON 结构、schema、元素 ID、受支持的元素名称、几何、循环、包体限制、图片资源路径、按钮方法名、运行时类协议，以及常见的绑定错误。
