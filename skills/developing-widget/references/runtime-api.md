# 运行时 API 参考

在编写 `execute.code`、生命周期方法、按钮处理、HTTP 请求、消息或 logger 调用时使用本参考。

## 类协议

`execute.code` 应默认导出一个继承 `Widget` 的类：

```js
export default class WeatherCard extends Widget {
  async onExecute() {
    return {}
  }
}
```

`Widget` 是宿主注入的全局符号，由运行时提供。不要 `import` 它，也不要在本地重新声明。校验器会对此做静态检查，但不会真正执行脚本。

## 上下文字段

在类内部可以使用：

- `this.$input`：由 `inputSchema` 派生的只读入参对象。
- `this.$output`：`onExecute` 成功返回的只读值，未返回时为 `undefined`。
- `this.$http`：宿主提供的 HTTP 客户端。
- `this.$sendMessage(...)`：在展示交互过程中发送用户可见消息。
- `this.$logger`：写入持久化日志。

类的实例字段会被镜像到 `renderContext.data`，可被元素绑定使用：

```js
export default class WeatherCard extends Widget {
  city = ''
  condition = ''
  temperature = ''
  loading = false

  async onExecute() {
    await this.refresh()
    return {
      city: this.city,
      condition: this.condition,
      temperature: this.temperature
    }
  }

  async refresh() {
    this.loading = true
    try {
      this.city = this.$input.city
      const response = await this.$http.get('https://api.example.com/weather', {
        query: { city: this.city }
      })
      this.condition = String(response.data.condition ?? '')
      this.temperature = String(response.data.temperature ?? '')
    } finally {
      this.loading = false
    }
  }
}
```

对于使用裸绑定（如 `{{ condition }}` 或 `{{ loading }}`）渲染的字段，需要在 `dataSchema.properties` 中声明同名字段。

## 生命周期

`onExecute` 在模型打开 Widget 时执行，可返回一个 output 对象。`onMounted` 在 Widget 展示时执行。按钮动作与自定义事件会在同一次实时展示会话中调用同一个 Widget 实例上的方法。

需要在渲染与历史恢复过程中保留的事实，应使用持久化字段。仅在当前实时会话中作为临时缓存使用的，才放到私有实例状态里。

## 按钮方法

按钮动作按名称调用方法：

```json
{ "actions": [{ "method": "refresh", "args": [] }] }
```

类必须声明 `refresh()` 或 `async refresh()`。不要依赖默认的占位方法。

## HTTP、消息与日志

网络请求使用 `this.$http.get/post/put/patch/delete`，不要使用浏览器全局对象。需要回流到聊天中的交互结果使用 `this.$sendMessage`。持久化日志使用 `this.$logger.info/warn/error`。

运行时负载会跨越 worker 边界。input、output、data 与方法参数都应是 JSON 安全的。不要把 DOM 事件、函数、Vue 代理或其他不可克隆对象作为业务数据传递。
