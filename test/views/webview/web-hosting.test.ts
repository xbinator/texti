/**
 * @file web-hosting.test.ts
 * @description 验证 WebView 宿主层 DOM 节点管理。
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { ensureHostedWebviewElement, ensureWebviewHostLayer, WEBVIEW_HOST_LAYER_ID } from '@/views/webview/web/utils/hosting';

describe('webview hosting', () => {
  afterEach((): void => {
    document.body.innerHTML = '';
  });

  it('creates short stable host layer ids from long route keys', (): void => {
    const firstHostKey = '/webview/web?url=https%3A%2F%2Fexample.com%2Fvery%2Flong%2Fpath%3Fkeyword%3Dabcdefghijklmnopqrstuvwxyz';
    const secondHostKey = '/webview/web?url=https%3A%2F%2Fexample.org%2Fanother%2Flong%2Fpath%3Fkeyword%3Dabcdefghijklmnopqrstuvwxyz';

    const firstLayer = ensureWebviewHostLayer(document, firstHostKey);
    const sameFirstLayer = ensureWebviewHostLayer(document, firstHostKey);
    const secondLayer = ensureWebviewHostLayer(document, secondHostKey);

    expect(firstLayer).toBe(sameFirstLayer);
    expect(firstLayer.id).toMatch(new RegExp(`^${WEBVIEW_HOST_LAYER_ID}-webview-web-[a-z0-9]+$`));
    expect(firstLayer.id.length).toBeLessThanOrEqual(48);
    expect(firstLayer.id).not.toContain('example.com');
    expect(firstLayer.id).not.toContain('%3A');
    expect(secondLayer.id).not.toBe(firstLayer.id);
  });

  it('enables popup requests on created and reused webview elements', (): void => {
    const hostLayer = document.createElement('div');
    const firstElement = ensureHostedWebviewElement(hostLayer);

    expect(firstElement.hasAttribute('allowpopups')).toBe(true);

    firstElement.removeAttribute('allowpopups');
    const reusedElement = ensureHostedWebviewElement(hostLayer);

    expect(reusedElement).toBe(firstElement);
    expect(reusedElement.hasAttribute('allowpopups')).toBe(true);
  });
});
