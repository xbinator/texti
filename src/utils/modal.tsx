import type { VNode } from 'vue';
import { createApp, h, ref } from 'vue';
import { Input } from 'ant-design-vue';
import BModal from '@/components/BModal/index.vue';
import BButton from '@/components/BButton/index.vue';

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
  onCancel: () => void;
  onConfirm: () => void;
  confirmText?: string;
  danger?: boolean;
}

interface ConfirmModalOptions {
  title?: string;
  content: string;
  confirmText?: string;
  danger?: boolean;
}

interface InputOptions {
  defaultValue?: string;
  placeholder?: string;
  okText?: string;
}

type DeleteOptions = Pick<ModalOptions, 'title'>;

// ——— RenderModal ———

function RenderModal({ open, content, footer, onClose, title, width, ...rest }: RenderModalProps) {
  return (
    <BModal open={open} title={title} width={width || 400} closable maskClosable onClose={onClose} {...rest}>
      {{
        default: content,
        footer: footer ?? undefined
      }}
    </BModal>
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

function FooterButtons({ onCancel, onConfirm, confirmText = '确定', danger = false }: FooterButtonsProps) {
  return (
    <div style={{ textAlign: 'right' }}>
      <BButton type="secondary" onClick={onCancel} style={{ marginRight: '8px' }}>
        取消
      </BButton>
      <BButton type={danger ? 'primary' : 'secondary'} onClick={onConfirm}>
        {confirmText}
      </BButton>
    </div>
  );
}

// ——— Render 函数 ———

function RenderConfirmModal({ content, title, confirmText, danger }: ConfirmModalOptions): Promise<[boolean, boolean]> {
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
        footer: () => <FooterButtons onCancel={onCancel} onConfirm={onConfirm} confirmText={confirmText} danger={danger} />
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
  static confirm(title: string, content: string): Promise<[boolean, boolean]> {
    return RenderConfirmModal({ content, title });
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
