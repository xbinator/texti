import { Ref } from 'vue';
import type { ToolbarOption } from '@/components/Toolbar.vue';
import { native, File } from '@/utils/native';

export function useToolbar(sourceFile: Ref<Partial<File>>) {
  const toolbarMenuOptions: ToolbarOption[] = [
    {
      value: 'new',
      label: '新建',
      shortcut: 'Ctrl+N',
      divider: true,
      onClick: () => {
        //  native.setWindowTitle('新建文件')
      }
    },
    {
      value: 'open',
      label: '打开',
      shortcut: 'Ctrl+O',
      divider: true,
      onClick: async () => {
        const file = await native.openFile();
        console.log('🚀 ~ onClick: ~ file:', file);
        if (!file.path) return;

        native.setWindowTitle(`${file.name}.${file.ext}`);
        // 更新文件信息
        sourceFile.value = file;
      }
    },
    {
      value: 'save',
      label: '保存',
      shortcut: 'Ctrl+S',
      onClick: () => {
        //
      }
    },
    {
      value: 'saveAs',
      label: '另存为',
      shortcut: 'Ctrl+Shift+S',
      onClick: () => {
        //
      }
    }
  ];

  return { toolbarMenuOptions };
}
