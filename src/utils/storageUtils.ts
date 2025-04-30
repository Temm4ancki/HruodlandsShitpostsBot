import * as fs from 'fs';
import * as path from 'path';
import { getCurrentTime } from './index';

/**
 * Интерфейс для информации о файле сообщения
 */
interface MessageFileInfo {
  id: number;
  path: string;
  createdTime: number;
}

/**
 * Получает список всех файлов обработанных сообщений в указанной директории
 */
export async function getProcessedMessageFiles(directoryPath: string): Promise<MessageFileInfo[]> {
  try {
    const files = await fs.promises.readdir(directoryPath);
    
    // Фильтруем файлы с меткой .processed
    const processedFiles = files.filter(file => file.endsWith('.processed'));
    
    // Собираем информацию о каждом файле
    const fileInfoPromises = processedFiles.map(async (file) => {
      const filePath = path.join(directoryPath, file);
      const stats = await fs.promises.stat(filePath);
      const messageId = parseInt(file.split('.')[0]); // Извлекаем ID сообщения из имени файла
      
      return {
        id: messageId,
        path: filePath,
        createdTime: stats.mtimeMs || stats.ctimeMs, // Время модификации или создания файла
      };
    });
    
    return await Promise.all(fileInfoPromises);
  } catch (error) {
    console.error(`[${getCurrentTime()}] Error getting processed message files:`, error);
    return [];
  }
}

/**
 * Получает все связанные файлы для сообщения (включая медиа)
 */
export async function getRelatedMessageFiles(directoryPath: string, messageId: number): Promise<string[]> {
  try {
    const files = await fs.promises.readdir(directoryPath);
    
    // Фильтруем файлы, которые начинаются с ID сообщения
    return files
      .filter(file => file.startsWith(`${messageId}.`) || file.startsWith(`${messageId}_`))
      .map(file => path.join(directoryPath, file));
  } catch (error) {
    console.error(`[${getCurrentTime()}] Error getting related message files:`, error);
    return [];
  }
}

/**
 * Получает список всех медиа-файлов для указанного сообщения
 * @param directoryPath Путь к директории с файлами
 * @param messageId ID сообщения
 * @returns Массив путей к медиа-файлам
 */
export async function getMessageMediaFiles(directoryPath: string, messageId: number): Promise<string[]> {
  try {
    const files = await fs.promises.readdir(directoryPath);
    
    // Фильтруем файлы, которые начинаются с ID сообщения, но не являются .processed
    return files
      .filter(file => 
        (file.startsWith(`${messageId}.`) || file.startsWith(`${messageId}_`)) && 
        !file.endsWith('.processed')
      )
      .map(file => path.join(directoryPath, file));
  } catch (error) {
    console.error(`[${getCurrentTime()}] Error getting message media files:`, error);
    return [];
  }
}

/**
 * Удаляет файл с обработкой ошибок
 * @param filePath Путь к файлу
 * @returns true в случае успеха, false в случае ошибки
 */
export async function deleteFile(filePath: string): Promise<boolean> {
  try {
    await fs.promises.unlink(filePath);
    return true;
  } catch (error) {
    console.error(`[${getCurrentTime()}] Error deleting file ${filePath}:`, error);
    return false;
  }
}

/**
 * Удаляет все медиа-файлы для указанного сообщения
 * @param directoryPath Путь к директории с файлами
 * @param messageId ID сообщения
 * @returns Количество удаленных файлов
 */
export async function deleteMessageMediaFiles(directoryPath: string, messageId: number): Promise<number> {
  try {
    // Получаем список всех медиа-файлов для данного сообщения
    const mediaFiles = await getMessageMediaFiles(directoryPath, messageId);
    
    // Удаляем каждый файл
    let deletedCount = 0;
    for (const filePath of mediaFiles) {
      const success = await deleteFile(filePath);
      if (success) {
        deletedCount++;
      }
    }
    
    return deletedCount;
  } catch (error) {
    console.error(`[${getCurrentTime()}] Error deleting message media files:`, error);
    return 0;
  }
}

/**
 * Удаляет медиа-файлы для группы сообщений
 * @param directoryPath Путь к директории с файлами
 * @param messageIds Массив ID сообщений
 * @returns Количество удаленных файлов
 */
export async function deleteGroupMediaFiles(directoryPath: string, messageIds: number[]): Promise<number> {
  try {
    let totalDeleted = 0;
    
    for (const messageId of messageIds) {
      const deletedCount = await deleteMessageMediaFiles(directoryPath, messageId);
      totalDeleted += deletedCount;
    }
    
    return totalDeleted;
  } catch (error) {
    console.error(`[${getCurrentTime()}] Error deleting group media files:`, error);
    return 0;
  }
}

/**
 * Очищает старые сообщения, оставляя только указанное количество последних
 */
export async function cleanupOldMessages(channelDirectory: string, maxMessagesToKeep: number): Promise<number> {
  try {
    // Проверяем существование директории
    try {
      await fs.promises.access(channelDirectory);
    } catch (error) {
      console.log(`[${getCurrentTime()}] Directory ${channelDirectory} does not exist, nothing to clean.`);
      return 0;
    }
    
    // Получаем все обработанные сообщения
    const processedFiles = await getProcessedMessageFiles(channelDirectory);
    
    // Если количество файлов меньше или равно максимальному, ничего не делаем
    if (processedFiles.length <= maxMessagesToKeep) {
      console.log(`[${getCurrentTime()}] Only ${processedFiles.length} messages, no cleanup needed.`);
      return 0;
    }
    
    // Сортируем файлы по времени создания (сначала новые)
    const sortedFiles = processedFiles.sort((a, b) => b.createdTime - a.createdTime);
    
    // Отбираем файлы для удаления (все, кроме maxMessagesToKeep последних)
    const filesToDelete = sortedFiles.slice(maxMessagesToKeep);
    
    // Удаляем файлы
    let deletedCount = 0;
    for (const fileInfo of filesToDelete) {
      // Удаляем файл метки обработки
      await deleteFile(fileInfo.path);
      
      // Получаем и удаляем все связанные файлы (медиа)
      const relatedFiles = await getRelatedMessageFiles(channelDirectory, fileInfo.id);
      for (const relatedFile of relatedFiles) {
        await deleteFile(relatedFile);
      }
      
      deletedCount++;
    }
    
    console.log(`[${getCurrentTime()}] Cleaned up ${deletedCount} old messages from ${channelDirectory}`);
    return deletedCount;
  } catch (error) {
    console.error(`[${getCurrentTime()}] Error cleaning up old messages:`, error);
    return 0;
  }
}

/**
 * Очищает только медиа-файлы для сообщений, оставляя метки обработки
 * @param channelDirectory Путь к директории канала
 * @param messageIds Массив ID сообщений для очистки (если не указан, очищаются все)
 * @returns Количество удаленных файлов
 */
export async function cleanupMessageMediaFiles(channelDirectory: string, messageIds?: number[]): Promise<number> {
  try {
    // Проверяем существование директории
    try {
      await fs.promises.access(channelDirectory);
    } catch (error) {
      console.log(`[${getCurrentTime()}] Directory ${channelDirectory} does not exist, nothing to clean.`);
      return 0;
    }
    
    let targetMessageIds: number[] = [];
    
    // Если ID сообщений не указаны, получаем все обработанные сообщения
    if (!messageIds || messageIds.length === 0) {
      const processedFiles = await getProcessedMessageFiles(channelDirectory);
      targetMessageIds = processedFiles.map(file => file.id);
    } else {
      targetMessageIds = messageIds;
    }
    
    // Удаляем медиа-файлы для всех указанных сообщений
    const deletedCount = await deleteGroupMediaFiles(channelDirectory, targetMessageIds);
    
    console.log(`[${getCurrentTime()}] Cleaned up ${deletedCount} media files from ${channelDirectory}`);
    return deletedCount;
  } catch (error) {
    console.error(`[${getCurrentTime()}] Error cleaning up message media files:`, error);
    return 0;
  }
}

/**
 * Очищает старые медиа-файлы, оставляя только для указанного количества последних сообщений
 */
export async function cleanupOldMediaFiles(channelDirectory: string, maxMessagesToKeep: number): Promise<number> {
  try {
    // Проверяем существование директории
    try {
      await fs.promises.access(channelDirectory);
    } catch (error) {
      console.log(`[${getCurrentTime()}] Directory ${channelDirectory} does not exist, nothing to clean.`);
      return 0;
    }
    
    // Получаем все обработанные сообщения
    const processedFiles = await getProcessedMessageFiles(channelDirectory);
    
    // Если количество файлов меньше или равно максимальному, ничего не делаем
    if (processedFiles.length <= maxMessagesToKeep) {
      console.log(`[${getCurrentTime()}] Only ${processedFiles.length} messages, no cleanup needed.`);
      return 0;
    }
    
    // Сортируем файлы по времени создания (сначала новые)
    const sortedFiles = processedFiles.sort((a, b) => b.createdTime - a.createdTime);
    
    // Отбираем IDs последних maxMessagesToKeep сообщений, которые нужно сохранить
    const idsToKeep = new Set(sortedFiles.slice(0, maxMessagesToKeep).map(file => file.id));
    
    // Получаем список всех файлов в директории
    const allFiles = await fs.promises.readdir(channelDirectory);
    
    // Удаляем все медиа-файлы, которые не относятся к последним maxMessagesToKeep сообщениям
    let deletedCount = 0;
    
    for (const file of allFiles) {
      try {
        // Проверяем, не является ли файл .processed
        if (file.endsWith('.processed')) {
          continue; // Не удаляем .processed файлы
        }
        
        // Извлекаем ID сообщения из имени файла
        const fileNameParts = file.split('.');
        const idPart = fileNameParts[0].split('_')[0]; // Обрабатываем случаи вида "123_converted.mp4"
        const messageId = parseInt(idPart);
        
        // Если это не числовой ID или файл принадлежит к последним сообщениям, пропускаем
        if (isNaN(messageId) || idsToKeep.has(messageId)) {
          continue;
        }
        
        // Удаляем файл
        const filePath = path.join(channelDirectory, file);
        await deleteFile(filePath);
        deletedCount++;
      } catch (err) {
        console.error(`[${getCurrentTime()}] Error processing file ${file}:`, err);
      }
    }
    
    console.log(`[${getCurrentTime()}] Cleaned up ${deletedCount} old media files from ${channelDirectory}`);
    return deletedCount;
  } catch (error) {
    console.error(`[${getCurrentTime()}] Error cleaning up old media files:`, error);
    return 0;
  }
}
