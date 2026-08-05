/**
 * @file operationScript.ts
 * @description WebView 自动化页面操作脚本生成器。
 */
import type { ActiveWebviewSnapshotElement } from './types';
import type { WebviewOperateInput } from '@/views/webview/web/types';
import { WEBVIEW_PAGE_ELEMENT_LIMIT } from './constants';
import { createRuntimeScript } from './engine/runtime';

/**
 * 构建页面操作脚本。
 * @param input - WebView 操作输入
 * @param snapshotElements - 快照中的元素身份信息
 * @returns 可通过 `executeJavaScript` 执行的脚本
 */
export function createPageOperationScript(input: WebviewOperateInput, snapshotElements: ActiveWebviewSnapshotElement[] = []): string {
  const serializedInput = JSON.stringify(input);
  const serializedSnapshotElements = JSON.stringify(snapshotElements);
  return `
(async () => {
  const input = ${serializedInput};
  const snapshotElements = ${serializedSnapshotElements};
  ${createRuntimeScript()}

  const { refs, indexedNodes } = __tibisWebviewEngine.collectFlatDomTree({ elementLimit: ${WEBVIEW_PAGE_ELEMENT_LIMIT} });
  const findElement = (index) => refs.get(index) || null;
  const findNode = (index) => indexedNodes.find((node) => node.highlightIndex === index) || null;
  const findExpectedElement = (index) => snapshotElements.find((item) => item && item.index === index) || null;
  const assertElementMatchesSnapshot = (node, index) => {
    const expected = findExpectedElement(index);
    if (!expected || typeof expected.fingerprint !== 'string' || !expected.fingerprint) return;
    if (!node || node.fingerprint !== expected.fingerprint) throw new Error('STALE_SNAPSHOT');
  };
  const createTarget = (element, index) => element ? { index, label: __tibisWebviewEngine.readLabel(element).slice(0, 300), tagName: element.tagName } : null;
  const dispatchInputEvents = (element) => {
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: element.value || element.innerText || '' }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const readScrollPosition = (target) => {
    if (target) {
      return { x: Number(target.scrollLeft || 0), y: Number(target.scrollTop || 0) };
    }

    return {
      x: Number(window.scrollX || document.documentElement.scrollLeft || document.body.scrollLeft || 0),
      y: Number(window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0)
    };
  };
  const scrollTarget = (target, direction, pixels) => {
    const numericPixels = Number(pixels);
    const amount = Number.isFinite(numericPixels) && numericPixels > 0 ? numericPixels : Math.round(window.innerHeight * 0.7);
    const left = direction === 'left' ? -amount : direction === 'right' ? amount : 0;
    const top = direction === 'up' ? -amount : direction === 'down' ? amount : 0;
    const before = readScrollPosition(target);
    if (target) {
      target.scrollBy({ left, top, behavior: 'auto' });
    } else {
      window.scrollBy({ left, top, behavior: 'auto' });
    }

    const after = readScrollPosition(target);
    return {
      targetType: target ? 'element' : 'window',
      before,
      after,
      changed: before.x !== after.x || before.y !== after.y
    };
  };
  const resolveClickTarget = (element) => {
    if (typeof document.elementsFromPoint !== 'function') return element;

    const rect = __tibisWebviewEngine.readViewportRect(element);
    if (rect.width <= 0 || rect.height <= 0) return element;

    const x = Math.max(0, Math.min(window.innerWidth - 1, rect.x + rect.width / 2));
    const y = Math.max(0, Math.min(window.innerHeight - 1, rect.y + rect.height / 2));
    const hit = document
      .elementsFromPoint(x, y)
      .find(
        (candidate) =>
          candidate instanceof HTMLElement &&
          candidate !== document.body &&
          candidate !== document.documentElement &&
          __tibisWebviewEngine.containsComposedElement(element, candidate)
      );
    return hit instanceof HTMLElement ? hit : element;
  };
  const pressKeyMap = {
    Enter: { code: 'Enter', keyCode: 13 },
    Tab: { code: 'Tab', keyCode: 9 },
    Escape: { code: 'Escape', keyCode: 27 },
    ArrowUp: { code: 'ArrowUp', keyCode: 38 },
    ArrowDown: { code: 'ArrowDown', keyCode: 40 },
    ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
    ArrowRight: { code: 'ArrowRight', keyCode: 39 }
  };
  const isPressKey = (key) => Object.prototype.hasOwnProperty.call(pressKeyMap, key);
  const dispatchKeyboardEvent = (target, type, key) => {
    const meta = pressKeyMap[key];
    const event = new KeyboardEvent(type, {
      key,
      code: meta.code,
      keyCode: meta.keyCode,
      which: meta.keyCode,
      bubbles: true,
      cancelable: true,
      composed: true
    });
    return target.dispatchEvent(event);
  };
  const submitClosestFormForEnter = (target) => {
    if (!(target instanceof HTMLElement)) return false;
    const form = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
      ? target.form
      : target.closest('form');
    if (!(form instanceof HTMLFormElement)) return false;
    return form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) === false;
  };
  const pressTarget = (target, key) => {
    if (!isPressKey(key)) throw new Error('INVALID_INPUT');
    target.focus({ preventScroll: true });
    const keydownAllowed = dispatchKeyboardEvent(target, 'keydown', key);
    const shouldSendKeypress = key === 'Enter';
    const keypressAllowed = shouldSendKeypress ? dispatchKeyboardEvent(target, 'keypress', key) : true;
    const submitted = key === 'Enter' && keydownAllowed && keypressAllowed ? submitClosestFormForEnter(target) : false;
    dispatchKeyboardEvent(target, 'keyup', key);
    return { submitted };
  };
  const readWaitSeconds = (value) => {
    const seconds = Number(value);
    if (!Number.isFinite(seconds)) return 1;
    return Math.max(0, Math.min(5, seconds));
  };
  const isScrollDirection = (direction) => ['up', 'down', 'left', 'right'].includes(direction);
  const action = input.action || {};
  if (document.readyState === 'loading' && action.type !== 'wait') {
    throw new Error('PAGE_LOADING');
  }
  if (action.type === 'wait') {
    await new Promise((resolve) => window.setTimeout(resolve, readWaitSeconds(action.seconds) * 1000));
    return {
      ok: true,
      action: 'wait',
      target: null,
      message: 'waited',
      navigationStarted: document.readyState === 'loading',
      pageChanged: document.readyState === 'loading',
      shouldReadAgain: document.readyState === 'loading'
    };
  }
  if (action.type === 'scroll' && typeof action.index !== 'number') {
    if (!isScrollDirection(action.direction)) throw new Error('INVALID_INPUT');
    const scroll = scrollTarget(null, action.direction, action.pixels);
    return {
      ok: true,
      action: 'scroll',
      target: null,
      message: scroll.changed ? 'executed' : 'no scroll movement',
      scroll,
      navigationStarted: document.readyState === 'loading',
      pageChanged: scroll.changed,
      shouldReadAgain: scroll.changed
    };
  }
  const node = typeof action.index === 'number' ? findNode(action.index) : null;
  const element = typeof action.index === 'number' ? findElement(action.index) : null;
  if (!element || !node) throw new Error('ELEMENT_NOT_FOUND');
  assertElementMatchesSnapshot(node, action.index);
  if (element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true') throw new Error('ACTION_NOT_SUPPORTED');
  if (action.type !== 'scroll') {
    element.scrollIntoView({ block: 'center', inline: 'center' });
  }
  let scroll = null;
  if (action.type === 'click') {
    const clickTarget = resolveClickTarget(element);
    const PointerEventClass = window.PointerEvent || MouseEvent;
    clickTarget.dispatchEvent(new PointerEventClass('pointerdown', { bubbles: true }));
    clickTarget.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    clickTarget.focus({ preventScroll: true });
    clickTarget.dispatchEvent(new PointerEventClass('pointerup', { bubbles: true }));
    clickTarget.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    clickTarget.click();
  } else if (action.type === 'input') {
    if (typeof action.text !== 'string') throw new Error('INVALID_INPUT');
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const nextValue = action.clear === false ? element.value + action.text : action.text;
      const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value');
      if (descriptor && typeof descriptor.set === 'function') {
        descriptor.set.call(element, nextValue);
      } else {
        element.value = nextValue;
      }
      dispatchInputEvents(element);
    } else if (element.isContentEditable) {
      element.textContent = action.clear === false ? String(element.textContent || '') + action.text : action.text;
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: action.text }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      throw new Error('ACTION_NOT_SUPPORTED');
    }
  } else if (action.type === 'select') {
    if (typeof action.optionText !== 'string') throw new Error('INVALID_INPUT');
    if (!(element instanceof HTMLSelectElement)) throw new Error('ACTION_NOT_SUPPORTED');
    const matches = Array.from(element.options).filter(
      (option) => option.text === action.optionText || option.text.trim() === String(action.optionText || '').trim()
    );
    if (matches.length > 1) throw new Error('OPTION_AMBIGUOUS');
    if (matches.length < 1) throw new Error('ELEMENT_NOT_FOUND');
    element.value = matches[0].value;
    element.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (action.type === 'press') {
    if (typeof action.key !== 'string') throw new Error('INVALID_INPUT');
    pressTarget(element, action.key);
  } else if (action.type === 'scroll') {
    if (!isScrollDirection(action.direction)) throw new Error('INVALID_INPUT');
    const directTarget = __tibisWebviewEngine.canScrollElementInDirection(element, action.direction) ? element : null;
    const target = directTarget || __tibisWebviewEngine.findScrollableAncestor(element, action.direction);
    scroll = scrollTarget(target, action.direction, action.pixels);
  } else {
    throw new Error('ACTION_NOT_SUPPORTED');
  }
  return {
    ok: true,
    action: action.type,
    target: createTarget(element, action.index),
    message: scroll && !scroll.changed ? 'no scroll movement' : 'executed',
    ...(scroll ? { scroll } : {}),
    navigationStarted: document.readyState === 'loading',
    pageChanged: scroll ? scroll.changed : true,
    shouldReadAgain: scroll ? scroll.changed : true
  };
})();
`;
}
