/**
 * @file ai.d.ts
 * @description AI related global type declarations.
 */
import type { ModelMessage } from 'ai';
import type { JSONSchema7 } from 'json-schema';

/**
 * Provider request format types.
 */
export type AIProviderType = 'openai' | 'anthropic' | 'google' | 'deepseek';

/** AI tool source type. */
export type AIToolSource = 'builtin' | 'custom' | 'mcp';

/** AI tool permission level. */
export type AIToolPermission = 'read' | 'write' | 'dangerous';

/** AI tool execution status. */
export type AIToolExecutionStatus = 'success' | 'failure' | 'cancelled' | 'awaiting_user_input';

/**
 * AI choice option.
 * @description Single option entry used by waiting user input questions.
 */
export interface AIChoiceOption {
  /** Visible label. */
  label: string;
  /** Submitted value. */
  value: string;
  /** Optional description. */
  description?: string;
}

/**
 * AI awaiting user choice question.
 * @description Payload used when a tool pauses for user input.
 */
export interface AIAwaitingUserChoiceQuestion {
  /** Generated question identifier. */
  questionId: string;
  /** Related tool call identifier. */
  toolCallId: string;
  /** Selection mode. */
  mode: 'single' | 'multiple';
  /** Prompt text. */
  question: string;
  /** Available options. */
  options: AIChoiceOption[];
  /** Whether other text input is allowed. */
  allowOther: boolean;
  /** Maximum selections for multiple choice. */
  maxSelections?: number;
}

/**
 * AI tool parameter schema.
 * @description JSON Schema wrapper used for tool parameter validation.
 */
export interface AIToolParameterSchema {
  /** Schema type, fixed to object. */
  type: 'object';
  /** Property definitions. */
  properties: Record<string, unknown>;
  /** Required property names. */
  required?: string[];
  /** Whether extra properties are allowed. */
  additionalProperties?: boolean;
}

/**
 * AI tool definition.
 * @description Metadata describing an AI tool.
 */
export interface AIToolDefinition {
  /** Tool name. */
  name: string;
  /** Tool description. */
  description: string;
  /** Tool source. */
  source: AIToolSource;
  /** Permission level. */
  permission: AIToolPermission;
  /** Parameter schema. */
  parameters: AIToolParameterSchema;
  /** Whether this tool needs the current editor document context. Defaults to true. */
  requiresActiveDocument?: boolean;
}

/**
 * Editor selection.
 */
export interface EditorSelection {
  /** Selection start. */
  from: number;
  /** Selection end. */
  to: number;
  /** Selected text. */
  text: string;
}

/**
 * AI tool execution context.
 * @description Document and editor information required by tools.
 */
export interface AIToolContext {
  /** Current document information. */
  document: {
    /** Document identifier. */
    id: string;
    /** Document title. */
    title: string;
    /** File path or null for unsaved documents. */
    path: string | null;
    /** Read the document content. */
    getContent: () => string;
  };
  /** Editor operations. */
  editor: {
    /** Read the current selection. */
    getSelection: () => EditorSelection | null;
    /** Insert content at the cursor. */
    insertAtCursor: (content: string) => Promise<void>;
    /** Replace the current selection. */
    replaceSelection: (content: string) => Promise<void>;
    /** Replace the entire document content. */
    replaceDocument: (content: string) => Promise<void>;
  };
}

/**
 * AI tool execution error.
 * @description Describes why a tool execution failed.
 */
export interface AIToolExecutionError {
  /** Error code. */
  code:
    | 'TOOL_NOT_FOUND'
    | 'INVALID_INPUT'
    | 'NO_ACTIVE_DOCUMENT'
    | 'NO_SELECTION'
    | 'NO_CURSOR'
    | 'USER_CANCELLED'
    | 'EDITOR_UNAVAILABLE'
    | 'STALE_CONTEXT'
    | 'TOOL_TIMEOUT'
    | 'UNSUPPORTED_PROVIDER'
    | 'CONFIRMATION_DISMISSED'
    | 'EXECUTION_FAILED';
  /** Error message. */
  message: string;
}

/**
 * AI tool execution success result.
 * @description status = success.
 */
export interface AIToolExecutionSuccessResult<TResult = unknown> {
  /** Tool name. */
  toolName: string;
  /** Execution status. */
  status: 'success';
  /** Success payload. */
  data: TResult;
  /** Success results do not carry errors. */
  error?: never;
}

/**
 * AI tool execution failure result.
 * @description status = failure.
 */
export interface AIToolExecutionFailureResult {
  /** Tool name. */
  toolName: string;
  /** Execution status. */
  status: 'failure';
  /** Failure details. */
  error: AIToolExecutionError;
  /** Failure results do not carry data. */
  data?: never;
}

/**
 * AI tool execution cancelled result.
 * @description status = cancelled.
 */
export interface AIToolExecutionCancelledResult {
  /** Tool name. */
  toolName: string;
  /** Execution status. */
  status: 'cancelled';
  /** Cancellation details. */
  error: AIToolExecutionError;
  /** Cancelled results do not carry data. */
  data?: never;
}

/**
 * AI tool execution awaiting user input result.
 * @description status = awaiting_user_input.
 */
export interface AIToolExecutionAwaitingUserInputResult {
  /** Tool name. */
  toolName: string;
  /** Execution status. */
  status: 'awaiting_user_input';
  /** Question payload. */
  data: AIAwaitingUserChoiceQuestion;
  /** Awaiting results do not carry errors. */
  error?: never;
}

/**
 * AI tool execution result.
 * @description Discriminated union over all terminal tool states.
 */
export type AIToolExecutionResult<TResult = unknown> =
  | AIToolExecutionSuccessResult<TResult>
  | AIToolExecutionFailureResult
  | AIToolExecutionCancelledResult
  | AIToolExecutionAwaitingUserInputResult;

/**
 * AI tool executor interface.
 * @description Defines tool execution capability.
 */
export interface AIToolExecutor<TInput = unknown, TResult = unknown> {
  /** Tool definition. */
  definition: AIToolDefinition;
  /**
   * Execute the tool.
   * @param input - Tool input.
   * @param context - Execution context, omitted for tools that do not require an active document.
   * @returns Tool execution result.
   */
  execute(input: TInput, context?: AIToolContext): Promise<AIToolExecutionResult<TResult>>;
}

export interface AICreateOptions {
  /** Provider type. */
  providerType: AIProviderType;
  /** Provider identifier. */
  providerId: string;
  /** Provider name. */
  providerName: string;
  /** API key. */
  apiKey?: string;
  /** Optional base URL. */
  baseUrl?: string;
}

/**
 * AI transport tool result.
 * @description Used to send tool results back to the model.
 */
export interface AITransportToolResult {
  /** Tool call identifier. */
  toolCallId: string;
  /** Tool name. */
  toolName: string;
  /** Tool result payload. */
  result: unknown;
}

export interface AITransportTool {
  /** Tool name. */
  name: string;
  /** Tool description. */
  description: string;
  /** Tool parameter schema. */
  parameters: JSONSchema7;
}

export interface AIRequestOptions {
  /** Request identifier. */
  requestId?: string;
  /** Provider identifier. */
  providerId?: string;
  /** Model identifier. */
  modelId: string;
  /** Prompt text. */
  prompt?: string;
  /** System instruction. */
  system?: string;
  /** Temperature. */
  temperature?: number;
  /** Conversation messages. */
  messages?: ModelMessage[];
  /** Available tools. */
  tools?: AITransportTool[];
  /** Previous tool results. */
  toolResults?: AITransportToolResult[];
}

export interface AIStreamToolCallChunk {
  toolCallId: string;
  toolName: string;
  input: unknown;
}

/**
 * Provider model metadata.
 */
export interface AIProviderModel {
  /** Unique identifier. */
  id: string;
  /** Display name. */
  name: string;
  /** Model type. */
  type: string;
  /** Whether this model is enabled. */
  isEnabled: boolean;
  /** Context window size. */
  contextWindow?: number;
  /** Whether tool use is supported. */
  supportsTools?: boolean;
  /** Whether vision is supported. */
  supportsVision?: boolean;
  /** Whether deep thinking is supported. */
  supportsDeepThought?: boolean;
  /** Whether web search is supported. */
  supportsWebSearch?: boolean;
  /** Whether image generation is supported. */
  supportsImageGeneration?: boolean;
  /** Whether video recognition is supported. */
  supportsVideoRecognition?: boolean;
}

/**
 * AI service error.
 * @description Extends the base error structure with a code field.
 */
export interface AIServiceError {
  /** Error code. */
  code: AIErrorCode;
  /** Error message. */
  message: string;
}

/**
 * AI provider configuration.
 */
export interface AIProvider {
  /** Unique provider identifier. */
  id: string;
  /** Provider display name. */
  name: string;
  /** Provider description. */
  description: string;
  /** Provider request format type. */
  type: AIProviderType;
  /** Whether the provider is enabled. */
  isEnabled: boolean;
  /** API key. */
  apiKey?: string;
  /** Optional base URL. */
  baseUrl?: string;
  /** Provider logo. */
  logo?: string;
  /** Whether this is a user-defined provider. */
  isCustom?: boolean;
  /** Whether the provider is read-only. */
  readonly?: boolean;
  /** Supported models. */
  models?: AIProviderModel[];
}

/**
 * AI custom provider payload.
 * @description Data used when creating or updating a provider.
 */
export interface AICustomProvider {
  /** Unique identifier. */
  id: string;
  /** Provider display name. */
  name: string;
  /** Provider description. */
  description?: string;
  /** Provider request format type. */
  type: AIProviderType;
  /** Provider logo. */
  logo?: string;
  /** Whether the provider is enabled. */
  isEnabled?: boolean;
  /** API key. */
  apiKey?: string;
  /** Optional base URL. */
  baseUrl?: string;
}

export interface AIUsage {
  /** Input token count. */
  inputTokens: number;
  /** Output token count. */
  outputTokens: number;
  /** Total token count. */
  totalTokens: number;
}

export interface AIInvokeResult {
  text: string;
  usage?: AIUsage;
}

export interface AIStreamResult {
  stream: StreamTextResult['textStream'];
}

export interface AIStreamFinishChunk {
  usage: AIUsage;
}
