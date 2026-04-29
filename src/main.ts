import { createApp } from 'vue';
import { createPinia } from 'pinia';
import 'virtual:uno.css';
import 'ant-design-vue/dist/reset.css';
import App from './App.vue';
import { setupPlugins } from './plugins';
import { setupErrorHandler } from './plugins/error-handler';
import router from './router';
import { initErrorCollector } from './shared/logger/error-collector';
import './assets/styles/index.less';

const app = createApp(App);
const pinia = createPinia();

setupPlugins();

// 初始化 Vue 错误处理
setupErrorHandler(app);

app.use(pinia);
app.use(router);
app.mount('#app');

// 初始化全局错误收集
initErrorCollector();
