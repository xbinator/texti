import { isTauri } from './platform'

export interface FileAPI {
  openFile(): Promise<string | null>
  saveFile(content: string, path?: string): Promise<string | null>
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
  setWindowTitle(title: string): Promise<void>
}

class TauriFileAPI implements FileAPI {
  async openFile(): Promise<string | null> {
    const { open } = await import('@tauri-apps/plugin-dialog')
    
    const file = await open({
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
    })
    
    if (file) {
      return file as string
    }
    return null
  }

  async saveFile(content: string, path?: string): Promise<string | null> {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const { writeTextFile } = await import('@tauri-apps/plugin-fs')
    
    if (path) {
      await writeTextFile(path, content)
      return path
    }
    
    const file = await save({
      filters: [{ name: 'Markdown', extensions: ['md'] }],
      defaultPath: 'untitled.md'
    })
    
    if (file) {
      await writeTextFile(file, content)
      return file
    }
    
    return null
  }

  async readFile(path: string): Promise<string> {
    const { readTextFile } = await import('@tauri-apps/plugin-fs')
    return await readTextFile(path)
  }

  async writeFile(path: string, content: string): Promise<void> {
    const { writeTextFile } = await import('@tauri-apps/plugin-fs')
    await writeTextFile(path, content)
  }

  async setWindowTitle(title: string): Promise<void> {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const appWindow = getCurrentWindow()
    await appWindow.setTitle(title)
  }
}

class WebFileAPI implements FileAPI {
  async openFile(): Promise<string | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.md,.markdown'
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0]
        if (file) {
          const content = await file.text()
          sessionStorage.setItem('web-editor-path', file.name)
          sessionStorage.setItem('web-editor-content', content)
          resolve(file.name)
        } else {
          resolve(null)
        }
      }
      input.click()
    })
  }

  async saveFile(content: string, path?: string): Promise<string | null> {
    const filename = path || sessionStorage.getItem('web-editor-path') || 'untitled.md'
    const blob = new Blob([content], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    
    URL.revokeObjectURL(url)
    return filename
  }

  async readFile(): Promise<string> {
    const content = sessionStorage.getItem('web-editor-content') || ''
    return content
  }

  async writeFile(path: string, content: string): Promise<void> {
    sessionStorage.setItem('web-editor-path', path)
    sessionStorage.setItem('web-editor-content', content)
  }

  async setWindowTitle(title: string): Promise<void> {
    document.title = title
  }
}

export const fileAPI: FileAPI = isTauri() ? new TauriFileAPI() : new WebFileAPI()
