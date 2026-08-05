/**
 * @file use-recent-record.test.ts
 * @description 验证最近记录公共打开与删除用例。
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRecentRecord } from '@/hooks/useRecentRecord';
import type { RecentRecord, StoredDocumentRecord } from '@/shared/storage';

const routerPushMock = vi.hoisted(() => vi.fn<(_path: string) => Promise<void>>());
const openDocumentMock = vi.hoisted(() => vi.fn<(_record: StoredDocumentRecord) => Promise<StoredDocumentRecord | null>>());
const openWebviewMock = vi.hoisted(() => vi.fn<(_url: URL) => void>());
const loadSessionByIdMock = vi.hoisted(() => vi.fn<(_sessionId: string) => Promise<unknown>>());
const removeRecentMock = vi.hoisted(() => vi.fn<(_id: string) => Promise<void>>());
const removeTabMock = vi.hoisted(() => vi.fn<(_id: string) => void>());

vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: routerPushMock
  })
}));

vi.mock('@/hooks/useNavigate', () => ({
  useNavigate: () => ({
    openDocument: openDocumentMock,
    openWebview: openWebviewMock
  })
}));

vi.mock('@/stores/chat/session', () => ({
  useChatSessionStore: () => ({
    loadSessionById: loadSessionByIdMock
  })
}));

vi.mock('@/stores/workspace/recent', () => ({
  useRecentStore: () => ({
    removeFile: removeRecentMock
  })
}));

vi.mock('@/stores/workspace/tabs', () => ({
  useTabsStore: () => ({
    removeTab: removeTabMock
  })
}));

/**
 * 创建文件最近记录。
 * @param overrides - 覆盖字段
 * @returns 文件最近记录
 */
function createFileRecord(overrides: Partial<Extract<RecentRecord, { type: 'file' }>> = {}): Extract<RecentRecord, { type: 'file' }> {
  return {
    type: 'file',
    id: 'file-1',
    url: '/editor/file-1',
    title: 'alpha.md',
    description: '/tmp/alpha.md',
    path: '/tmp/alpha.md',
    content: '',
    savedContent: '',
    name: 'alpha',
    ext: 'md',
    ...overrides
  };
}

/**
 * 创建 Widget 最近记录。
 * @param overrides - 覆盖字段
 * @returns Widget 最近记录
 */
function createWidgetRecord(overrides: Partial<Extract<RecentRecord, { type: 'widget' }>> = {}): Extract<RecentRecord, { type: 'widget' }> {
  return {
    type: 'widget',
    id: 'widget-1',
    url: '/widget/widget-1',
    title: 'dashboard.widget',
    description: '/tmp/dashboard.widget',
    path: '/tmp/dashboard.widget',
    content: '',
    savedContent: '',
    name: 'dashboard',
    ext: 'widget',
    ...overrides
  };
}

/**
 * 创建聊天最近记录。
 * @param overrides - 覆盖字段
 * @returns 聊天最近记录
 */
function createChatRecord(overrides: Partial<Extract<RecentRecord, { type: 'chat' }>> = {}): Extract<RecentRecord, { type: 'chat' }> {
  return {
    type: 'chat',
    id: 'session-a',
    url: '/chat/session-a',
    title: '会话 A',
    description: '聊天会话',
    createdAt: 1,
    openedAt: 2,
    ...overrides
  };
}

/**
 * 创建 WebView 最近记录。
 * @param overrides - 覆盖字段
 * @returns WebView 最近记录
 */
function createWebviewRecord(overrides: Partial<Extract<RecentRecord, { type: 'webview' }>> = {}): Extract<RecentRecord, { type: 'webview' }> {
  return {
    type: 'webview',
    id: 'web-1',
    url: 'https://example.com',
    title: 'Example Domain',
    description: 'https://example.com',
    createdAt: 1,
    openedAt: 2,
    ...overrides
  };
}

describe('useRecentRecord', (): void => {
  beforeEach((): void => {
    routerPushMock.mockReset();
    routerPushMock.mockResolvedValue(undefined);
    openDocumentMock.mockReset();
    openDocumentMock.mockImplementation(async (record: StoredDocumentRecord): Promise<StoredDocumentRecord> => record);
    openWebviewMock.mockReset();
    loadSessionByIdMock.mockReset();
    loadSessionByIdMock.mockResolvedValue({ id: 'session-a' });
    removeRecentMock.mockReset();
    removeRecentMock.mockResolvedValue(undefined);
    removeTabMock.mockReset();
  });

  it('opens document records through the file opener', async (): Promise<void> => {
    const actions = useRecentRecord();
    const record = createFileRecord();

    await actions.openRecentRecord(record);

    expect(openDocumentMock).toHaveBeenCalledWith(record);
    expect(routerPushMock).not.toHaveBeenCalled();
  });

  it('opens widget records through the document handler', async (): Promise<void> => {
    const actions = useRecentRecord();
    const record = createWidgetRecord();

    await actions.openRecentRecord(record);

    expect(openDocumentMock).toHaveBeenCalledWith(record);
    expect(routerPushMock).not.toHaveBeenCalled();
  });

  it('opens chat records through their url without loading the session again', async (): Promise<void> => {
    const actions = useRecentRecord();

    await actions.openRecentRecord(createChatRecord());

    expect(loadSessionByIdMock).not.toHaveBeenCalled();
    expect(routerPushMock).toHaveBeenCalledWith('/chat/session-a');
  });

  it('keeps chat recent opening route-only even when the backing session is absent', async (): Promise<void> => {
    const actions = useRecentRecord();
    loadSessionByIdMock.mockResolvedValue(undefined);

    await actions.openRecentRecord(createChatRecord());

    expect(removeRecentMock).not.toHaveBeenCalled();
    expect(routerPushMock).toHaveBeenCalledWith('/chat/session-a');
  });

  it('opens WebView records through the webview opener', async (): Promise<void> => {
    const actions = useRecentRecord();

    await actions.openRecentRecord(createWebviewRecord());

    expect(openWebviewMock).toHaveBeenCalledWith(new URL('https://example.com'));
    expect(routerPushMock).not.toHaveBeenCalled();
  });

  it('routes WebView records with non-http urls through router', async (): Promise<void> => {
    const actions = useRecentRecord();

    await actions.openRecentRecord(createWebviewRecord({ url: '/webview/local' }));

    expect(openWebviewMock).not.toHaveBeenCalled();
    expect(routerPushMock).toHaveBeenCalledWith('/webview/local');
  });

  it('removes document records by stable key and closes their tab', async (): Promise<void> => {
    const actions = useRecentRecord();

    await actions.removeRecentRecord(createFileRecord());

    expect(removeRecentMock).toHaveBeenCalledWith('file:file-1');
    expect(removeTabMock).toHaveBeenCalledWith('file-1');
  });

  it('removes widget records by stable key and closes their tab', async (): Promise<void> => {
    const actions = useRecentRecord();

    await actions.removeRecentRecord(createWidgetRecord());

    expect(removeRecentMock).toHaveBeenCalledWith('widget:widget-1');
    expect(removeTabMock).toHaveBeenCalledWith('widget-1');
  });

  it('removes chat records by stable key without closing document tabs', async (): Promise<void> => {
    const actions = useRecentRecord();

    await actions.removeRecentRecord(createChatRecord());

    expect(removeRecentMock).toHaveBeenCalledWith('chat:session-a');
    expect(removeTabMock).not.toHaveBeenCalled();
  });
});
