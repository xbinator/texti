/**
 * @file modal.tsx
 * @description 命令式弹窗工具，提供提示、确认、删除和输入弹窗能力。
 */
import type { DefineComponent, VNode } from 'vue';
import { createApp, h, ref, withDirectives } from 'vue';
import { Input } from 'ant-design-vue';
import BButton from '@/components/BButton/index.vue';
import type { BButtonProps } from '@/components/BButton/types';
import BModal from '@/components/BModal/index.vue';
import type { BModalProps } from '@/components/BModal/types';
import { vFocus } from '@/directives/focus';

// ——— 类型 ———

interface ModalInstance {
  close: () => void;
}

interface ModalOptions {
  title?: string;
  width?: string | number;
}

interface RenderModalProps {
  open: boolean;
  content: () => VNode;
  footer?: () => VNode;
  onClose: () => void;
  'onUpdate:open': (val: boolean) => void;
  title?: string;
  width?: string | number;
}

interface FooterButtonsProps {
  onCancel?: () => void;
  onConfirm: () => void;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

interface ConfirmModalOptions {
  title?: string;
  /** 弹窗正文，支持字符串或 VNode（用于富文本/分段样式） */
  content: string | VNode;
  /** 弹窗宽度，默认 400 */
  width?: string | number;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

/**
 * 输入弹窗可选项
 */
interface InputOptions {
  /** 输入框初始值 */
  defaultValue?: string;
  /** 占位提示文本 */
  placeholder?: string;
  /** 确认按钮文案，默认"确定" */
  okText?: string;
  /** 是否在弹窗打开后自动聚焦输入框，默认 true */
  autofocus?: boolean;
}

type DeleteOptions = Pick<ModalOptions, 'title' | 'width'>;

type BModalComponentProps = BModalProps & {
  onClose?: () => void;
  'onUpdate:open'?: (val: boolean) => void;
};

type BButtonComponentProps = BButtonProps & {
  onClick?: () => void;
};

const BModalComponent = BModal as DefineComponent<BModalComponentProps>;
const BButtonComponent = BButton as DefineComponent<BButtonComponentProps>;

// ——— RenderModal ———

function RenderModal({ open, content, footer, onClose, title, width, ...rest }: RenderModalProps) {
  return (
    <BModalComponent open={open} title={title} width={width || 400} closable maskClosable onClose={onClose} {...rest}>
      {{
        default: content,
        footer: footer ?? undefined
      }}
    </BModalComponent>
  );
}

// ——— createModalInstance ———

function createModalInstance(renderModal: (props: { open: boolean; onClose: () => void; 'onUpdate:open': (val: boolean) => void }) => VNode): ModalInstance {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const visible = ref(true);
  let closed = false;

  let app: ReturnType<typeof createApp>;

  const close = (): void => {
    if (closed) return;
    closed = true;
    visible.value = false;
    setTimeout(() => {
      app.unmount();
      container.remove();
    }, 300);
  };

  app = createApp({
    render() {
      return renderModal({
        open: visible.value,
        onClose: close,
        'onUpdate:open': (val: boolean) => {
          visible.value = val;
        }
      });
    }
  });

  app.mount(container);
  return { close };
}

// ——— 内部组件 ———

function FooterButtons({ onCancel, onConfirm, confirmText = '确定', cancelText = '取消', danger = false }: FooterButtonsProps) {
  return (
    <div style={{ textAlign: 'right' }}>
      {onCancel && (
        <BButtonComponent type="secondary" onClick={onCancel} style={{ marginRight: '8px' }}>
          {cancelText}
        </BButtonComponent>
      )}
      <BButtonComponent type="primary" onClick={onConfirm} danger={danger}>
        {confirmText}
      </BButtonComponent>
    </div>
  );
}

// ——— Render 函数 ———

function RenderAlertModal({ content, title, width, confirmText }: Omit<ConfirmModalOptions, 'danger'>): Promise<void> {
  return new Promise((resolve) => {
    let instance: ModalInstance;
    let settled = false;

    /**
     * 结束提示弹窗流程，避免关闭事件与按钮事件重复结算。
     */
    const finish = (): void => {
      if (settled) {
        return;
      }

      settled = true;
      resolve();
      instance.close();
    };

    instance = createModalInstance((controlProps) =>
      h(RenderModal, {
        ...controlProps,
        onClose: finish,
        title,
        width,
        content: () => <div style={{ marginBottom: '16px' }}>{content}</div>,
        footer: () => <FooterButtons onConfirm={finish} confirmText={confirmText || '知道了'} />
      })
    );
  });
}

function RenderConfirmModal({ content, title, width, confirmText, cancelText, danger }: ConfirmModalOptions): Promise<[boolean, boolean]> {
  return new Promise((resolve) => {
    let instance: ModalInstance;
    let settled = false;

    /**
     * 完成确认流程并关闭弹窗，避免关闭事件与按钮事件重复结算。
     * @param result - 取消与确认状态
     */
    const finish = (result: [boolean, boolean]): void => {
      if (settled) {
        return;
      }

      settled = true;
      resolve(result);
      instance.close();
    };

    const onConfirm = (): void => {
      finish([false, true]);
    };
    const onCancel = (): void => {
      finish([true, false]);
    };

    instance = createModalInstance((controlProps) =>
      h(RenderModal, {
        ...controlProps,
        onClose: onCancel,
        title,
        width,
        content: () => <div style={{ marginBottom: '16px', userSelect: 'text' }}>{content}</div>,
        footer: () => <FooterButtons onCancel={onCancel} onConfirm={onConfirm} confirmText={confirmText} cancelText={cancelText} danger={danger} />
      })
    );
  });
}

function RenderInputModal(title: string, options: InputOptions = {}): Promise<[false, string] | [true]> {
  const { defaultValue = '', placeholder = '', okText = '确定', autofocus = true } = options;

  return new Promise((resolve) => {
    let instance: ModalInstance;
    let settled = false;
    const inputValue = ref(defaultValue);

    /**
     * 结束输入弹窗流程，确保关闭按钮、遮罩和底部按钮只结算一次。
     * @param result - 输入弹窗结果
     */
    const finish = (result: [false, string] | [true]): void => {
      if (settled) {
        return;
      }

      settled = true;
      resolve(result);
      instance.close();
    };

    const onCancel = (): void => {
      finish([true]);
    };
    const onConfirm = (): void => {
      finish([false, inputValue.value.trim()]);
    };

    instance = createModalInstance((controlProps) => {
      /* 复用 v-focus 指令：nextTick + 100ms 等待 AInput 内部 input 渲染，
         且每次更新按 binding 变化重新触发，避免二次打开失效 */
      const inputVNode = h(Input, {
        value: inputValue.value,
        style: { width: '100%' },
        'onUpdate:value': (val: string) => (inputValue.value = val),
        placeholder
      });
      return h(RenderModal, {
        ...controlProps,
        onClose: onCancel,
        title,
        content: () => (autofocus ? withDirectives(inputVNode, [[vFocus, true]]) : inputVNode),
        footer: () => <FooterButtons onCancel={onCancel} onConfirm={onConfirm} confirmText={okText} />
      });
    });
  });
}

// ——— 公共 API ———

export class Modal {
  static alert(title: string, content: string, confirmText?: string): Promise<void> {
    return RenderAlertModal({ content, title, confirmText });
  }

  static confirm(
    title: string,
    content: string | VNode,
    options?: { confirmText?: string; cancelText?: string; width?: string | number }
  ): Promise<[boolean, boolean]> {
    return RenderConfirmModal({ content, title, ...options });
  }

  static delete(content: string | VNode, options: DeleteOptions = {}): Promise<[boolean, boolean]> {
    return RenderConfirmModal({
      content,
      title: options.title ?? '删除确认',
      width: options.width,
      confirmText: '删除',
      danger: true
    });
  }

  static input(title: string, options: InputOptions = {}) {
    return RenderInputModal(title, options);
  }
}
