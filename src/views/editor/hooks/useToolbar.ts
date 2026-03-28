import { Ref } from 'vue';
import type { DropdownOption } from '@/components/BDropdown/type';
import { native, File } from '@/utils/native';

export function useToolbar(sourceFile: Ref<Partial<File>>) {
  const toolbarMenuOptions: DropdownOption[] = [
    {
      value: 'new',
      label: '新建',
      onClick: () => {
        //  native.setWindowTitle('新建文件')
      }
    },
    {
      value: 'open',
      label: '打开',
      onClick: async () => {
        const file = await native.openFile();
        if (!file.path) return;

        native.setWindowTitle(`${file.name}.${file.ext}`);
        // 更新文件信息
        sourceFile.value = file;
      }
    },
    {
      value: 'save',
      label: '保存',
      onClick: () => {
        //
      }
    },
    {
      value: 'saveAs',
      label: '另存为',
      onClick: () => {
        //
      }
    }
  ];

  return { toolbarMenuOptions };
}
