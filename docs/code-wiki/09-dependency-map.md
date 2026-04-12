# 09-依赖与调用关系图

## 分层依赖（概览）

```mermaid
flowchart TB
  subgraph Renderer[Renderer (Vue)]
    UI[src/views + src/components]
    Stores[src/stores]
    Shared[src/shared]
    Hooks[src/hooks]
  end

  subgraph Bridge[Preload]
    API[window.electronAPI]
  end

  subgraph Main[Electron Main]
    IPC[ipc handlers]
    Svc[services]
    DB[(SQLite)]
    Store[(electron-store)]
  end

  UI --> Hooks
  UI --> Stores
  UI --> Shared
  Hooks --> Shared
  Shared --> API
  API --> IPC
  IPC --> Svc
  Svc --> DB
  Svc --> Store
```

## 关键调用链：Provider 设置保存

```mermaid
sequenceDiagram
  participant Page as Provider UI
  participant Hook as useProviders
  participant Storage as providerStorage
  participant Bridge as electronAPI
  participant IPC as db:execute handler
  participant DB as provider_settings/custom_providers

  Page->>Hook: saveProviderConfig/toggleProvider/saveProviderModels
  Hook->>Storage: updateProvider(...)
  Storage->>Bridge: dbExecute(UPSERT..., params)
  Bridge->>IPC: invoke('db:execute', sql, params)
  IPC->>DB: run(sql)
  DB-->>IPC: result
  IPC-->>Bridge: resolve
  Bridge-->>Storage: ok
  Storage-->>Hook: next provider
  Hook-->>Page: reloadProviders()
```

## 关键调用链：AI 流式生成

```mermaid
sequenceDiagram
  participant UI as Editor/Selection AI UI
  participant Agent as useAgent
  participant Storage as providerStorage
  participant Bridge as electronAPI
  participant IPC as ai:stream handler
  participant Svc as AIService
  participant SDK as ai.streamText

  UI->>Agent: agent.stream(request)
  Agent->>Storage: getProvider(providerId)
  Storage-->>Agent: provider (apiKey/baseUrl/type)
  Agent->>Bridge: onAiStreamChunk/onAiStreamComplete/onAiStreamError
  Agent->>Bridge: aiStream(createOptions, request)
  Bridge->>IPC: invoke('ai:stream')
  IPC->>Svc: streamText(createOptions, request)
  Svc->>SDK: streamText({model, prompt, system, temperature})
  loop chunks
    SDK-->>Svc: chunk
    Svc-->>IPC: chunk iterator
    IPC-->>UI: send('ai:stream:chunk', chunk)
  end
  IPC-->>UI: send('ai:stream:complete')
```

## 关键“收口点”依赖图

```mermaid
flowchart LR
  main[src/main.ts] --> app[src/App.vue]
  app --> router[src/router/index.ts]
  app --> store[src/stores/*]

  uiEditor[src/views/editor/index.vue] --> beditor[src/components/BEditor/index.vue]
  uiSettings[src/views/settings/*] --> providerHook[src/views/settings/provider/hooks/useProviders.ts]
  providerHook --> providerStorage[src/shared/storage/providers/sqlite.ts]
  uiSettings --> serviceModelStore[src/stores/service-model.ts]
  serviceModelStore --> serviceModelsStorage[src/shared/storage/service-models/sqlite.ts]

  providerStorage --> electronApi[src/shared/platform/electron-api.ts]
  serviceModelsStorage --> electronApi
  electronApi --> preload[electron/preload/index.mts]
  preload --> mainIpc[electron/main/modules/*/ipc.mts]
  mainIpc --> mainSvc[electron/main/modules/*/service.mts]
```
