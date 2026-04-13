# Create Message List Spec

## Why
目前 `BChat` 组件提供了基础的容器和输入框，但缺乏一个功能完整、支持多模态和丰富交互的“消息列表”组件来统一管理和展示对话内容。为了提升 AI 聊天体验，需要一个结构化的消息列表来呈现用户与 AI 之间的交互记录。

## What Changes
- 在 `BChat` 目录下（或其 `components` 目录）新增 `Messages` 组件。
- 支持“多模态”消息内容渲染（如图文混合）。
- 采用“左右气泡（微信风格）”的视觉排版。
- 单条消息支持多种快捷操作：复制内容、重新生成、编辑消息、删除消息。
- 采用普通列表渲染，结合现有的 `Container.vue` 滚动逻辑。

## Impact
- Affected specs: 聊天消息展示与交互能力。
- Affected code: 
  - `src/components/BChat/components/Messages.vue` (新建)
  - `src/components/BChat/index.vue` (引入并使用)
  - `src/components/BChat/types.ts` (扩展 `Message` 类型以支持多模态和状态)

## ADDED Requirements
### Requirement: 消息项展示与排版 (左右气泡)
The system SHALL display user messages aligned to the right and assistant messages aligned to the left, with avatars, styled as chat bubbles.

#### Scenario: 区分发送者
- **WHEN** 消息角色为 `user` 时
- **THEN** 消息气泡显示在右侧，头像在最右。
- **WHEN** 消息角色为 `assistant` 时
- **THEN** 消息气泡显示在左侧，头像在最左。

### Requirement: 多模态内容渲染
The system SHALL support rendering text, markdown, and images within a single message bubble.

### Requirement: 消息快捷交互
The system SHALL provide action buttons for each message item.

#### Scenario: 操作消息
- **WHEN** 用户将鼠标悬停在消息项上
- **THEN** 显示操作栏，包含复制、重新生成（仅 AI 消息）、编辑（仅用户消息）、删除等操作。

## MODIFIED Requirements
### Requirement: 扩展消息类型
在 `types.ts` 中扩展现有的 `Message` 接口，以支持多模态内容（如 `images?: string[]` 等字段）和消息唯一 ID。
