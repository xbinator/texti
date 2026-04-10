import { message } from 'ant-design-vue';

export function setupAntdMessage(): void {
  message.config({ top: '50px', duration: 3, maxCount: 1 });
}
