# 元素与绑定参考

在创建 `elements`、样式、分组、循环、图片、按钮或模板绑定时使用本参考。

## 基础元素

`elements` 与 group `children` 中的每个元素都应包含以下字段：

```json
{
  "id": "city-text",
  "name": "text",
  "label": "文本",
  "icon": "lucide:type",
  "title": "城市",
  "position": { "x": 16, "y": 16 },
  "size": { "width": 180, "height": 32 },
  "rotation": 0,
  "style": {},
  "loop": {
    "enabled": false,
    "source": "",
    "autoColumns": false,
    "columns": 1,
    "columnGap": 12,
    "rowGap": 12,
    "itemName": "",
    "indexName": ""
  },
  "metadata": { "content": "{{ $input.city }}" }
}
```

`name` 支持的取值为 `rect`、`text`、`image`、`button`、`group`、`swiper`。元素 ID 必须全局唯一，包括嵌套 group 内的元素。

## 元素 metadata

`rect` 仅使用样式和几何信息，其 metadata 可以为 `{}`。

`text` 的 metadata：

```json
{ "content": "{{ condition }}", "maxLines": 2 }
```

`maxLines` 控制最大可见行数。正整数会限制可见行数；非正数或缺省时文本完全可见。手动换行符（`\n`）也计入行数预算。

`image` 的 metadata：

```json
{ "src": "{{ iconUrl }}", "fit": "cover", "alt": "{{ condition }}" }
```

`button` 的 metadata：

```json
{
  "text": "刷新",
  "disabled": false,
  "loading": "{{ loading }}",
  "actions": [{ "method": "refresh", "args": [] }]
}
```

每个按钮的 `actions[].method` 都应是导出 Widget 类上已声明的方法。

`swiper` 的 metadata：

```json
{
  "images": [
    {
      "title": "首图",
      "src": "{{ $input.heroImage }}",
      "alt": "{{ $input.heroAlt }}"
    }
  ],
  "fit": "cover",
  "autoplay": true,
  "autoplayInterval": 3000,
  "animationDuration": 300,
  "initialIndex": 0,
  "loop": true,
  "showIndicator": true,
  "vertical": false,
  "indicatorColor": "#ffffff",
  "indicatorShape": "active-line"
}
```

`images` 至少保留一项。每项的 `src` 是图片地址，支持绑定；`alt` 是替代文本，支持绑定；`title` 只用于设置面板中区分图片项。`fit` 与 image 元素一致，支持 `cover`、`contain`、`fill`、`none`、`scale-down`。`autoplayInterval` 与 `animationDuration` 的单位均为 ms，`initialIndex` 从 0 开始。`indicatorShape` 支持 `dot`、`line`、`active-line`；其中 `dot` 是 3px 圆点，`line` 是短线，`active-line` 的未激活项是 3px 圆点、激活项是 10px 短线。

## 样式

`style` 接受任意标准 CSS 属性（使用 camelCase 键名）。常用字段包括 `backgroundColor`、`borderColor`、`borderStyle`、`borderWidth`、`borderRadius`、`padding`、`margin`、`color`、`fontSize`、`fontWeight`、`fontStyle`、`lineHeight`、`textDecoration`、`textAlign`、`textVerticalAlign`、`opacity`。

尺寸与字号使用正数。`opacity` 取值范围为 `0` 到 `1`。`padding`、`borderWidth`、`borderRadius`、`margin` 等盒型值可以是数字，或边/角数字对象。

## 分组

分组使用 `name: "group"`，可包含 `children`。子元素的位置相对于分组位置。非 group 元素不能包含 `children`。

## 循环

循环的 `source` 是绑定路径，不是 moustache 文本。使用裸运行时数据字段（如 `items`），不要写成 `{{ items }}`。

```json
{
  "enabled": true,
  "source": "items",
  "autoColumns": false,
  "columns": 2,
  "columnGap": 12,
  "rowGap": 12,
  "itemName": "item",
  "indexName": "index"
}
```

当父级宽度无法预先确定时，设置 `autoColumns: true`。在该模式下 `columns` 可以省略或写字面字符串 `"auto"`，运行时会按可用宽度计算列数。当 `autoColumns: false` 时，`columns` 必须是正整数。

在循环元素的 metadata 内，`item` 与 `index` 是本地绑定根：

```json
{ "content": "{{ item.label }} #{{ index }}" }
```

## 绑定

绑定在 metadata 字符串中使用 moustache 语法：

```text
{{ $input.city }}
{{ $output.summary }}
{{ condition }}
{{ forecast[0].temperature }}
```

根名称规则：

- `$input` 读取 `renderContext.input`。
- `$output` 读取 `onExecute` 成功返回的值。
- 裸名读取 `renderContext.data`。
- 循环本地根来自 `loop.itemName` 与 `loop.indexName`。

诸如 `{{ forecast[0].temperature }}` 和 `{{ user.profile.name }}` 这样的点号或下标路径会在运行时解析，但不会对 schema 做静态校验；只校验根名。请在对应 schema 中声明根名（裸根名用 `dataSchema`，`$input.x` 用 `inputSchema`，`$output.x` 用 `outputSchema`）。

## 图片资源

包内可包含本地资源文件，校验器会检查本地图片路径是否存在以及是否越界。当前图片渲染会直接把 image 元素的 `metadata.src` 与 swiper 元素的 `metadata.images[].src` 传给 `<img>`，因此除非已知宿主集成会分发包内资源，否则优先使用 HTTPS URL、data URL 或宿主可解析的 URL。
