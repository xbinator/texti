import localforage from 'localforage';
import { getElectronAPI, hasElectronAPI } from '../../platform/electron-api';
localforage.config({ name: 'Texti', storeName: 'files', description: 'Texti 笔记应用文件存储' });
const RECENT_FILES_KEY = 'recent_files';
const CURRENT_FILE_ID_KEY = 'current_file_id';
const MAX_RECENT_FILES = 100;
let electronLocalMigrationPromise = null;
async function getElectronStoreValue(key) {
    const value = await getElectronAPI().storeGet(key);
    return value ?? null;
}
async function setElectronStoreValue(key, value) {
    await getElectronAPI().storeSet(key, value);
}
async function deleteElectronStoreValue(key) {
    await getElectronAPI().storeDelete(key);
}
async function ensureElectronLocalMigration() {
    if (!hasElectronAPI())
        return;
    electronLocalMigrationPromise ??= (async () => {
        const [storeFiles, localFiles] = await Promise.all([
            getElectronStoreValue(RECENT_FILES_KEY),
            localforage.getItem(RECENT_FILES_KEY)
        ]);
        if ((!storeFiles || storeFiles.length === 0) && localFiles?.length) {
            await setElectronStoreValue(RECENT_FILES_KEY, localFiles.slice(0, MAX_RECENT_FILES));
        }
        const storeCurrentId = await getElectronStoreValue(CURRENT_FILE_ID_KEY);
        const localCurrentId = await localforage.getItem(CURRENT_FILE_ID_KEY);
        if (!storeCurrentId && localCurrentId) {
            await setElectronStoreValue(CURRENT_FILE_ID_KEY, localCurrentId);
        }
    })();
    await electronLocalMigrationPromise;
}
export const recentFilesStorage = {
    async addRecentFile(file) {
        const files = await this.getAllRecentFiles();
        const filtered = files.filter((item) => item.id !== file.id);
        filtered.unshift({ ...file });
        const nextFiles = filtered.slice(0, MAX_RECENT_FILES);
        if (hasElectronAPI()) {
            await setElectronStoreValue(RECENT_FILES_KEY, nextFiles);
            return;
        }
        await localforage.setItem(RECENT_FILES_KEY, nextFiles);
    },
    async getAllRecentFiles() {
        if (hasElectronAPI()) {
            await ensureElectronLocalMigration();
            return (await getElectronStoreValue(RECENT_FILES_KEY)) || [];
        }
        const files = await localforage.getItem(RECENT_FILES_KEY);
        return files || [];
    },
    async getRecentFile(id) {
        const files = await this.getAllRecentFiles();
        return files.find((file) => file.id === id) || null;
    },
    async updateRecentFile(id, file) {
        const files = await this.getAllRecentFiles();
        const index = files.findIndex((item) => item.id === id);
        if (index !== -1) {
            files[index] = { ...file };
            if (hasElectronAPI()) {
                await setElectronStoreValue(RECENT_FILES_KEY, files);
                return;
            }
            await localforage.setItem(RECENT_FILES_KEY, files);
        }
    },
    async removeRecentFile(...ids) {
        const files = await this.getAllRecentFiles();
        const filtered = files.filter((file) => !ids.includes(file.id));
        if (hasElectronAPI()) {
            await setElectronStoreValue(RECENT_FILES_KEY, filtered);
            return;
        }
        await localforage.setItem(RECENT_FILES_KEY, filtered);
    },
    async clearRecentFiles() {
        if (hasElectronAPI()) {
            await setElectronStoreValue(RECENT_FILES_KEY, []);
            return;
        }
        await localforage.setItem(RECENT_FILES_KEY, []);
    },
    async setCurrentFile(id) {
        if (hasElectronAPI()) {
            await setElectronStoreValue(CURRENT_FILE_ID_KEY, id);
            return;
        }
        await localforage.setItem(CURRENT_FILE_ID_KEY, id);
    },
    async getCurrentFileId() {
        if (hasElectronAPI()) {
            await ensureElectronLocalMigration();
            return getElectronStoreValue(CURRENT_FILE_ID_KEY);
        }
        return localforage.getItem(CURRENT_FILE_ID_KEY);
    },
    async clearCurrentFile() {
        if (hasElectronAPI()) {
            await deleteElectronStoreValue(CURRENT_FILE_ID_KEY);
            return;
        }
        await localforage.removeItem(CURRENT_FILE_ID_KEY);
    },
    async clear() {
        if (hasElectronAPI()) {
            await Promise.all([setElectronStoreValue(RECENT_FILES_KEY, []), deleteElectronStoreValue(CURRENT_FILE_ID_KEY)]);
            return;
        }
        await localforage.clear();
    }
};
