import * as path from 'path';
import * as fs from 'fs';
import config from '../config';
import { getCurrentTime } from './index';
import { cleanupOldMediaFiles } from './storageUtils';

/**
 * Получает список всех папок в директории media
 */
async function getChannelDirectories(mediaRootDir: string): Promise<string[]> {
  try {
    const items = await fs.promises.readdir(mediaRootDir, { withFileTypes: true });
    const dirs = items
      .filter(item => item.isDirectory())
      .map(dir => path.join(mediaRootDir, dir.name));
    
    return dirs;
  } catch (error) {
    console.error(`[${getCurrentTime()}] Error getting channel directories:`, error);
    return [];
  }
}

/**
 * Утилита для очистки медиа-файлов во всех каналах
 */
async function cleanupAllChannelsMedia(): Promise<void> {
  try {
    const mediaRootDir = path.join(process.cwd(), 'media');
    const maxStoredMessages = config.storage.maxStoredMessages;
    
    console.log(`[${getCurrentTime()}] Starting cleanup of all channels media. Keeping files for last ${maxStoredMessages} messages.`);
    
    // Получаем список всех директорий каналов
    const channelDirectories = await getChannelDirectories(mediaRootDir);
    
    if (channelDirectories.length === 0) {
      console.log(`[${getCurrentTime()}] No channel directories found.`);
      return;
    }
    
    // Очищаем медиа-файлы в каждой директории
    let totalDeleted = 0;
    for (const channelDir of channelDirectories) {
      console.log(`[${getCurrentTime()}] Cleaning up channel directory: ${path.basename(channelDir)}`);
      const deletedCount = await cleanupOldMediaFiles(channelDir, maxStoredMessages);
      totalDeleted += deletedCount;
    }
    
    console.log(`[${getCurrentTime()}] Total media files deleted: ${totalDeleted}`);
  } catch (error) {
    console.error(`[${getCurrentTime()}] Error during cleanup of all channels media:`, error);
  }
}

// Запускаем очис��ку, если файл запущен напрямую
if (require.main === module) {
  console.log(`[${getCurrentTime()}] Media cleanup utility started.`);
  cleanupAllChannelsMedia()
    .then(() => {
      console.log(`[${getCurrentTime()}] Media cleanup completed.`);
    })
    .catch(error => {
      console.error(`[${getCurrentTime()}] Media cleanup failed:`, error);
    });
}

export default cleanupAllChannelsMedia;