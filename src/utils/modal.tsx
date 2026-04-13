import type { DefineComponent, VNode } from 'vue';
import { createApp, h, ref } from 'vue';
import { Input } from 'ant-design-vue';
import BButton from '@/components/BButton/index.vue';
import type { BButtonProps } from '@/components/BButton/types';
import BModal from '@/components/BModal/index.vue';
import type { BModalProps } from '@/components/BModal/types';

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
  content: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

interface InputOptions {
  defaultValue?: string;
  placeholder?: string;
  okText?: string;
}

type DeleteOptions = Pick<ModalOptions, 'title'>;

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

function RenderAlertModal({ content, title, confirmText }: Omit<ConfirmModalOptions, 'danger'>): Promise<void> {
  return new Promise((resolve) => {
    let instance: ModalInstance;

    const onConfirm = (): void => {
      resolve();
      instance.close();
    };

    instance = createModalInstance((controlProps) =>
      h(RenderModal, {
        ...controlProps,
        title,
        content: () => <div style={{ marginBottom: '16px' }}>{content}</div>,
        footer: () => <FooterButtons onConfirm={onConfirm} confirmText={confirmText || '知道了'} />
      })
    );
  });
}

function RenderConfirmModal({ content, title, confirmText, cancelText, danger }: ConfirmModalOptions): Promise<[boolean, boolean]> {
  return new Promise((resolve) => {
    let instance: ModalInstance;

    const onConfirm = (): void => {
      resolve([false, true]);
      instance.close();
    };
    const onCancel = (): void => {
      resolve([true, false]);
      instance.close();
    };

    instance = createModalInstance((controlProps) =>
      h(RenderModal, {
        ...controlProps,
        title,
        content: () => <div style={{ marginBottom: '16px' }}>{content}</div>,
        footer: () => <FooterButtons onCancel={onCancel} onConfirm={onConfirm} confirmText={confirmText} cancelText={cancelText} danger={danger} />
      })
    );
  });
}

function RenderInputModal(title: string, options: InputOptions = {}): Promise<[false, string] | [true]> {
  const { defaultValue = '', placeholder = '', okText = '确定' } = options;

  return new Promise((resolve) => {
    let instance: ModalInstance;
    const inputValue = ref(defaultValue);

    const onCancel = (): void => {
      resolve([true]);
      instance.close();
    };
    const onConfirm = (): void => {
      resolve([false, inputValue.value.trim()]);
      instance.close();
    };

    instance = createModalInstance((controlProps) =>
      h(RenderModal, {
        ...controlProps,
        title,
        content: () => (
          <Input
            value={inputValue.value}
            style={{ width: '100%' }}
            onUpdate:value={(val: string) => (inputValue.value = val)}
            placeholder={placeholder}
            autofocus
          />
        ),
        footer: () => <FooterButtons onCancel={onCancel} onConfirm={onConfirm} confirmText={okText} />
      })
    );
  });
}

// ——— 公共 API ———

export class Modal {
  static alert(title: string, content: string, confirmText?: string): Promise<void> {
    return RenderAlertModal({ content, title, confirmText });
  }

  static confirm(title: string, content: string, options?: { confirmText?: string; cancelText?: string }): Promise<[boolean, boolean]> {
    return RenderConfirmModal({ content, title, ...options });
  }

  static delete(content: string, options: DeleteOptions = {}): Promise<[boolean, boolean]> {
    return RenderConfirmModal({
      content,
      title: options.title ?? '删除确认',
      confirmText: '删除',
      danger: true
    });
  }

  static input(title: string, options: InputOptions = {}) {
    return RenderInputModal(title, options);
  }
}
