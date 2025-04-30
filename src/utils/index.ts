import * as fs from 'fs';
import * as path from 'path';

/**
 * Возвращает текущее время в формате HH:MM
 */
export function getCurrentTime(): string {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

// Объект для хранения информации о проверенных папках
const checkedDirectories = new Set<string>();

/**
 * Создаёт папку для канала, если она не существует
 */
export async function ensureChannelDirectoryExistence(channelName: string): Promise<void> {
  const channelDir = path.join(process.cwd(), 'media', channelName);

  // Проверяем, была ли эта папка уже проверена
  if (checkedDirectories.has(channelDir)) {
    return; // Если проверена, ничего не делаем
  }

  try {
    await fs.promises.access(channelDir);
    console.log(`[${getCurrentTime()}] Folder "${channelName}" already exists.`);
  } catch (err) {
    try {
      await fs.promises.mkdir(channelDir, { recursive: true });
      console.log(`[${getCurrentTime()}] Folder "${channelName}" successfully created.`);
    } catch (err) {
      console.error(`[${getCurrentTime()}] Error creating folder "${channelName}":`, err);
    }
  }

  // Добавляем директорию в Set, чтобы не проверять её снова
  checkedDirectories.add(channelDir);
}

/**
 * Проверяет, было ли сообщение уже обработано
 */
export function isMessageProcessed(messageId: number, channelName: string): boolean {
  const processedFilePath = path.join(process.cwd(), 'media', channelName, `${messageId}.processed`);
  return fs.existsSync(processedFilePath); // Возвращает true, если файл .processed существует
}

/**
 * Помечает сообщение как обработанное
 */
export function markMessageAsProcessed(messageId: number, channelName: string): void {
  const processedFilePath = path.join(process.cwd(), 'media', channelName, `${messageId}.processed`);
  fs.writeFileSync(processedFilePath, 'processed'); // Создаёт файл с меткой о том, что сообщение обработано
}