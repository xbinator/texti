import { native } from '@/shared/platform';

export function useFileWatcher() {
  let watchedPath: string | null = null;

  async function switchWatchedFile(nextPath: string | null): Promise<void> {
    if (watchedPath === nextPath) return;

    if (watchedPath) {
      await native.unwatchFile();
      watchedPath = null;
    }

    if (nextPath) {
      await native.watchFile(nextPath);
      watchedPath = nextPath;
    }
  }

  async function clearWatchedFile(): Promise<void> {
    await switchWatchedFile(null);
  }

  function getWatchedPath(): string | null {
    return watchedPath;
  }

  return {
    switchWatchedFile,
    clearWatchedFile,
    getWatchedPath
  };
}
