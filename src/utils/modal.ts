import { Modal as AntdModal } from 'ant-design-vue';

export class Modal {
  /**
   * 封装 Modal.confirm，返回 [rejected, confirmed] 元组
   * @example
   * const [, confirmed] = await ModalManager.confirm('标题', '内容')
   * if (!confirmed) return
   */
  static confirm(title: string, content: string): Promise<[boolean, boolean]> {
    return new Promise((resolve) => {
      AntdModal.confirm({
        title,
        centered: true,
        content,
        maskClosable: true,
        autoFocusButton: null,
        onOk: () => resolve([false, true]),
        onCancel: () => resolve([true, false])
      });
    });
  }

  /**
   * 删除确认弹窗
   * @param content 删除内容描述
   * @returns [rejected, confirmed] 元组
   * @example
   * const [, confirmed] = await ModalManager.deleteConfirm('确定要删除这个文件吗？')
   * if (!confirmed) return
   */
  static delete(content: string): Promise<[boolean, boolean]> {
    return new Promise((resolve) => {
      AntdModal.confirm({
        title: '删除确认',
        centered: true,
        content,
        okText: '删除',
        okType: 'danger',
        cancelText: '取消',
        maskClosable: true,
        autoFocusButton: null,
        onOk: () => resolve([false, true]),
        onCancel: () => resolve([true, false])
      });
    });
  }
}
