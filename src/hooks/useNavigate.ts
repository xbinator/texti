/**
 * @file useNavigate.ts
 * @description Markdown/富文本链接点击统一导航逻辑
 */
import { useRouter } from 'vue-router';
import { native } from '@/shared/platform/native';

/**
 * 允许在应用内 webview 中打开的 URL 协议
 */
const WEBVIEW_SCHEMES = ['http:', 'https:'];

/**
 * 交给系统默认程序打开的 URL 协议
 */
const EXTERNAL_SCHEMES = ['mailto:', 'ftp:'];

/**
 * 创建统一的链接点击处理函数
 * @returns onLink - 绑定到 @click 的事件处理函数
 */
export function useNavigate() {
  const router = useRouter();

  /**
   * 统一处理 Markdown 渲染内容中的链接点击事件
   * - http/https 链接 → 应用内 webview 打开
   * - mailto/ftp 链接 → 系统默认程序打开
   * - 锚点/相对路径 → 不做处理（保留默认行为）
   * @param event - 鼠标点击事件
   */
  function onLink(event: MouseEvent): void {
    const { target } = event;
    if (!(target instanceof Element)) return;

    const anchor = target.closest('a[href]');
    if (!(anchor instanceof HTMLAnchorElement)) return;

    const rawHref = anchor.getAttribute('href');
    if (!rawHref) return;

    event.preventDefault();

    try {
      const url = new URL(rawHref, window.location.origin);

      if (WEBVIEW_SCHEMES.includes(url.protocol)) {
        router.push({ name: 'webview', query: { url: encodeURIComponent(url.href) } });
      } else if (EXTERNAL_SCHEMES.includes(url.protocol)) {
        native.openExternal(url.href);
      }
    } catch {
      // 非标准 URL（如 ./relative/path 或 #anchor），不做导航，浏览器默认行为
    }
  }

  return { onLink };
}
