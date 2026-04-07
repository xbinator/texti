# BModelIcon 组件

用于显示 AI 模型图标的组件，支持 light/dark 主题切换。

## 使用方法

```vue
<BModelIcon provider="openai" :size="24" />
<BModelIcon model="gpt-4" :size="32" />
```

### Props

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| provider | string | - | 服务商名称 |
| model | string | - | 模型名称 |
| size | number | 24 | 图标尺寸 |
| alt | string | '' | 图片 alt 文本 |

## 图标管理

### 图标来源

图标来自 [lobehub/lobe-icons](https://github.com/lobehub/lobe-icons) 项目。

### 目录结构

```
images/
├── light/          # 浅色主题图标
│   ├── openai.png
│   ├── anthropic.png
│   └── ...
└── dark/           # 深色主题图标
    ├── openai.png
    ├── anthropic.png
    └── ...
```

### 下载图标

运行以下 Python 脚本下载图标：

```python
#!/usr/bin/env python3
import urllib.request
import os
import ssl

BASE_URL = "https://cdn.jsdelivr.net/gh/lobehub/lobe-icons@master/packages/static-png"
IMAGES_DIR = os.path.dirname(os.path.abspath(__file__))

ICONS = [
    "openai",
    "anthropic",
    "google-color",
    "deepseek-color",
    "moonshot",
    "zhipu-color",
    "alibaba-color",
    "baidu-color",
    "bytedance-color",
    "minimax-color",
    "baichuan-color",
    "xiaomimimo",
    "microsoft-color",
    "aws-color",
    "meta-color",
    "mistral-color",
    "cohere-color",
    "stability-color",
    "midjourney",
    "siliconcloud-color",
    "hunyuan-color",
]

def download_icon(icon_name, theme):
    url = f"{BASE_URL}/{theme}/{icon_name}.png"
    output_path = os.path.join(IMAGES_DIR, theme, f"{icon_name}.png")
    
    try:
        ssl_context = ssl.create_default_context()
        ssl_context.check_hostname = False
        ssl_context.verify_mode = ssl.CERT_NONE
        
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, context=ssl_context, timeout=30) as response:
            with open(output_path, 'wb') as f:
                f.write(response.read())
        
        print(f"✓ Downloaded {theme}/{icon_name}.png")
        return True
    except Exception as e:
        print(f"✗ Failed to download {theme}/{icon_name}.png: {e}")
        return False

def main():
    for icon in ICONS:
        download_icon(icon, "light")
        download_icon(icon, "dark")

if __name__ == "__main__":
    main()
```

### 添加新图标

1. 在 `providerIconMap` 中添加映射关系：

```typescript
const providerIconMap: Record<string, string> = {
  // ...
  newprovider: 'newprovider-icon-name',
};
```

2. 下载对应的图标文件到 `images/light/` 和 `images/dark/` 目录

3. 如果图标在 CDN 上不存在，可以创建占位符图标：

```python
from PIL import Image, ImageDraw, ImageFont

def create_placeholder(name, theme, text):
    size = (64, 64)
    bg_color = (240, 240, 240) if theme == "light" else (40, 40, 40)
    text_color = (100, 100, 100) if theme == "light" else (200, 200, 200)
    
    img = Image.new('RGB', size, bg_color)
    draw = ImageDraw.Draw(img)
    
    font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 28)
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    position = ((size[0] - text_width) / 2, (size[1] - text_height) / 2)
    
    draw.text(position, text, fill=text_color, font=font)
    img.save(f"{theme}/{name}.png", 'PNG')
```

## 当前支持的图标

| 服务商 | 图标名称 |
|--------|----------|
| OpenAI | openai |
| Anthropic | anthropic |
| Google | google-color |
| DeepSeek | deepseek-color |
| Moonshot | moonshot |
| 智谱 AI | zhipu-color |
| 阿里云 | alibaba-color |
| 百度 | baidu-color |
| 字节跳动 | bytedance-color |
| MiniMax | minimax-color |
| 百川 | baichuan-color |
| 小米 | xiaomimimo |
| Microsoft | microsoft-color |
| AWS | aws-color |
| Meta | meta-color |
| Mistral | mistral-color |
| Cohere | cohere-color |
| Perplexity | perplexity-color |
| Stability AI | stability-color |
| Midjourney | midjourney-color |
| SiliconFlow | siliconcloud-color |
| 腾讯混元 | hunyuan-color |
| 自定义 | model |
