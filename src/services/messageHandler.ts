import * as path from 'path';
import { AttachmentBuilder } from 'discord.js';
import telegramService from './telegram';
import discordService from './discord';
import mediaProcessor from './mediaProcessor';
import messageFormatter from '../utils/messageFormatter';
import config from '../config';
import { 
  ensureChannelDirectoryExistence, 
  isMessageProcessed, 
  markMessageAsProcessed, 
  getCurrentTime 
} from '../utils';
import { cleanupOldMessages, deleteGroupMediaFiles, cleanupOldMediaFiles } from '../utils/storageUtils';

interface Message {
  id: number;
  date: number;
  message?: string;
  media?: any;
  entities?: any[];
}

// Список доменов, для которых разрешены эмбеды
const ALLOWED_EMBED_DOMAINS = [
  'youtube.com',
  'youtu.be',
  'vimeo.com',
  'twitch.tv',
  'twitter.com',
  'x.com',
  'instagram.com',
  'tiktok.com'
];

// Структура для хранения подготовленных медиа-файлов
interface PreparedMedia {
  messageId: number;
  attachmentPath: string;
  type: 'image' | 'video';
  needsCompression: boolean;
  isCompressed: boolean;
}

export class MessageHandler {
  /**
   * Проверяет, содержит ли текст ссылки на разрешенные домены для эмбедов
   * @param text Текст сообщения
   * @returns true, если текст содержит разрешенные домены
   */
  private containsAllowedEmbedDomains(text: string): boolean {
    return ALLOWED_EMBED_DOMAINS.some(domain => text.includes(domain));
  }

  /**
   * Получение ID последнего обработанного сообщения
   */
  getLastProcessedMessageId(): number {
    // В будущем можно реализовать сохранение в базу данных или файл
    return 0;
  }

  /**
   * Обработка новых сообщений в Telegram
   */
  async handleNewMessages(): Promise<void> {
    try {
      const lastProcessedMessageId = this.getLastProcessedMessageId();
      const channelName = await telegramService.getChannelName(config.telegram.channelId);
      const sanitizedChannelName = channelName.replace(/'/g, ""); // Убираем апострофы из названия

      const messages = await telegramService.getHistory(
        config.telegram.channelId,
        config.telegram.messageLimit,
        lastProcessedMessageId
      );

      const mediaDir = path.join(process.cwd(), 'media', sanitizedChannelName);
      await ensureChannelDirectoryExistence(sanitizedChannelName);

      // Сортируем сообщения по дате для корректной обработки
      const sortedMessages = messages.messages.sort((a: Message, b: Message) => a.date - b.date);

      let group: Message[] = []; // Временное хранилище для сообщений одной группы
      let previousMessageTime: number | null = null;

      for (const message of sortedMessages) {
        if (isMessageProcessed(message.id, sanitizedChannelName)) continue;

        const currentMessageTime = message.date; // Время отправки текущего сообщения

        // Проверяем разницу по времени
        if (
          previousMessageTime !== null &&
          (currentMessageTime - previousMessageTime) > 3 // Разница > 3 секунды — новая группа
        ) {
          await this.processMessageGroup(group, sanitizedChannelName, mediaDir); // Обрабатываем текущую группу
          group = []; // Начинаем новую группу
        }

        group.push(message); // Добавляем сообщение в группу
        previousMessageTime = currentMessageTime; // Обновляем время
      }

      // Обрабатываем последнюю группу, если она есть
      if (group.length > 0) {
        await this.processMessageGroup(group, sanitizedChannelName, mediaDir);
      }
      
      // Очищаем старые сообщения и медиа-файлы после обработки новых
      await this.cleanupOldMessages(sanitizedChannelName);
      await this.cleanupMediaFiles(sanitizedChannelName);
      
    } catch (err) {
      console.error(`[${getCurrentTime()}] Error receiving messages:`, err);
    }
  }

  /**
   * Очищает старые сообщения, оставляя только определённое количество последних
   */
  private async cleanupOldMessages(channelName: string): Promise<void> {
    try {
      const mediaDir = path.join(process.cwd(), 'media', channelName);
      const maxStoredMessages = config.storage.maxStoredMessages;
      
      console.log(`[${getCurrentTime()}] Starting cleanup of old messages. Keeping last ${maxStoredMessages} messages.`);
      
      // Выполняем очистку старых сообщений
      const deletedCount = await cleanupOldMessages(mediaDir, maxStoredMessages);
      
      if (deletedCount > 0) {
        console.log(`[${getCurrentTime()}] Cleaned up ${deletedCount} old messages.`);
      } else {
        console.log(`[${getCurrentTime()}] No messages needed to be cleaned up.`);
      }
    } catch (error) {
      console.error(`[${getCurrentTime()}] Error during message cleanup:`, error);
    }
  }

  /**
   * Очищает старые медиа-файлы, оставляя только для указанного количества последних сообщений
   */
  private async cleanupMediaFiles(channelName: string): Promise<void> {
    try {
      const mediaDir = path.join(process.cwd(), 'media', channelName);
      const maxStoredMessages = config.storage.maxStoredMessages;
      
      console.log(`[${getCurrentTime()}] Starting cleanup of old media files. Keeping files for last ${maxStoredMessages} messages.`);
      
      // Выполняем очистку старых медиа-файлов
      const deletedCount = await cleanupOldMediaFiles(mediaDir, maxStoredMessages);
      
      if (deletedCount > 0) {
        console.log(`[${getCurrentTime()}] Cleaned up ${deletedCount} old media files.`);
      } else {
        console.log(`[${getCurrentTime()}] No media files needed to be cleaned up.`);
      }
    } catch (error) {
      console.error(`[${getCurrentTime()}] Error during media files cleanup:`, error);
    }
  }

  /**
   * Помечает группу сообщений как обработанные
   * @param messages Массив сообщений для маркировки
   * @param channelName Имя канала
   * @returns Массив ID помеченных сообщений
   */
  private async markMessagesAsProcessed(messages: Message[], channelName: string): Promise<number[]> {
    const markedIds: number[] = [];
    
    for (const message of messages) {
      try {
        markMessageAsProcessed(message.id, channelName);
        markedIds.push(message.id);
        console.log(`[${getCurrentTime()}] Message ${message.id} marked as processed.`);
      } catch (error) {
        console.error(`[${getCurrentTime()}] Error marking message ${message.id} as processed:`, error);
      }
    }
    
    return markedIds;
  }

  /**
   * Обработка группы сообщений
   */
  private async processMessageGroup(group: Message[], sanitizedChannelName: string, mediaDir: string): Promise<void> {
    // Если группа пуста, ничего не делаем
    if (group.length === 0) return;
    
    // Сортируем сообщения в группе по ID для сохранения порядка
    const sortedGroup = group.sort((a, b) => a.id - b.id);

    const attachments: AttachmentBuilder[] = [];
    const preparedMedia: PreparedMedia[] = []; // Информация о подготовленных медиа-файлах
    let combinedText = ""; // Объединённый текст всех сообщений
    let containsVideoLinks = false; // Флаг наличия ссылок на видео-платформы
    
    let hasMediaToProcess = false; // Флаг наличия медиа, требующего обработки
    let allMediaProcessed = true; // Флаг успешной обработки всех медиа

    // Подготавливаем текст и предварительно скачиваем медиа-файлы
    try {
      for (const message of sortedGroup) {
        // Извлекаем текст и сущности из сообщения и форматируем их для Discord
        const { text, entities } = messageFormatter.extractMessageContent(message);
        if (text) {
          const formattedText = messageFormatter.formatMessage(text, entities);
          combinedText += formattedText + "\n";
          
          // Проверяем, содержит ли текст ссылки на разрешенные домены
          if (this.containsAllowedEmbedDomains(text)) {
            containsVideoLinks = true;
          }
        }

        if (message.media) {
          const media = message.media;
          
          if (media.className === "MessageMediaPhoto") {
            try {
              const originalFilePath = path.join(mediaDir, `${message.id}.jpg`);
              const buffer = await telegramService.downloadMedia(media);
              
              if (buffer) {
                // Сохраняем оригинальный файл
                mediaProcessor.saveBufferToFile(buffer, originalFilePath);
                
                // Добавляем информацию о медиа для последующей обработки
                preparedMedia.push({
                  messageId: message.id,
                  attachmentPath: originalFilePath,
                  type: 'image',
                  needsCompression: false, // Будет определено позже
                  isCompressed: false
                });
                
                hasMediaToProcess = true;
              }
            } catch (error) {
              console.error(`[${getCurrentTime()}] Error downloading photo for message ${message.id}:`, error);
              allMediaProcessed = false;
            }
          } else if (media.className === "MessageMediaDocument" && media.document.mimeType.startsWith("video/")) {
            try {
              const originalFilePath = path.join(mediaDir, `${message.id}.mp4`);
              const buffer = await telegramService.downloadMedia(media);
              
              if (buffer) {
                // Сохраняем оригинальный файл
                mediaProcessor.saveBufferToFile(buffer, originalFilePath);
                
                // Добавляем информацию о медиа для последующей обработки
                preparedMedia.push({
                  messageId: message.id,
                  attachmentPath: originalFilePath,
                  type: 'video',
                  needsCompression: false, // Будет определено позже
                  isCompressed: false
                });
                
                hasMediaToProcess = true;
              }
            } catch (error) {
              console.error(`[${getCurrentTime()}] Error downloading video for message ${message.id}:`, error);
              allMediaProcessed = false;
            }
          }
        }
      }
    } catch (error) {
      console.error(`[${getCurrentTime()}] Error preparing message group:`, error);
      return; // Прерываем обработку группы в случае ошибки
    }

    // Обрабатываем (конвертируем и сжимаем) подготовленные медиа-файлы
    if (hasMediaToProcess) {
      for (let i = 0; i < preparedMedia.length; i++) {
        const media = preparedMedia[i];
        
        try {
          const processedPath = path.join(
            mediaDir, 
            `${media.messageId}_processed${media.type === 'image' ? '.jpg' : '.mp4'}`
          );
          
          // Обрабатываем медиа для Discord (конвертация и сжатие при необходимости)
          const finalPath = await mediaProcessor.processMediaForDiscord(
            media.attachmentPath,
            processedPath,
            media.type
          );
          
          // Проверяем, было ли выполнено сжатие, сравнивая пути
          media.isCompressed = finalPath !== media.attachmentPath;
          
          // Обновляем путь к обработанному файлу
          media.attachmentPath = finalPath;
          
          // Добавляем файл в список вложений для отправки
          attachments.push(new AttachmentBuilder(finalPath));
          
          // Выводим информацию о размере файла
          const fileSize = await mediaProcessor.getFileSize(finalPath);
          console.log(`[${getCurrentTime()}] Processed ${media.type} size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);
        } catch (error) {
          console.error(`[${getCurrentTime()}] Error processing ${media.type} for message ${media.messageId}:`, error);
          allMediaProcessed = false;
        }
      }
    }

    // Если есть текст или вложения для отправки
    if (attachments.length > 0 || combinedText.trim()) {
      // Проверяем, все ли медиа были успешно обработаны
      if (hasMediaToProcess && !allMediaProcessed) {
        console.warn(`[${getCurrentTime()}] Not all media files were processed successfully, but continue with available ones.`);
      }
      
      try {
        // Отправляем сообщение в Discord
        await discordService.sendMessage(
          combinedText.trim() || null, 
          attachments,
          containsVideoLinks // разрешаем эмбеды только для сообщений с видео-ссылками
        );
        
        // ВАЖНО: Помечаем сообщения как обработанные ТОЛЬКО после успешной отправки
        // Также учитываем, что если медиа не удалось обработать, сообщения не должны помечаться
        if (allMediaProcessed || !hasMediaToProcess) {
          await this.markMessagesAsProcessed(sortedGroup, sanitizedChannelName);
          console.log(`[${getCurrentTime()}] Message group successfully sent to Discord and marked as processed.`);
        } else {
          console.warn(`[${getCurrentTime()}] Message group was sent partially, but not marked as processed due to media processing failures.`);
        }
      } catch (error) {
        console.error(`[${getCurrentTime()}] Error sending message group to Discord:`, error);
        console.log(`[${getCurrentTime()}] Messages will be processed again on next check.`);
      }
    } else if (sortedGroup.length > 0) {
      // Если сообщения не содержат ни текста, ни вложений, помечаем их как обработанные
      console.log(`[${getCurrentTime()}] Processing empty message group with no content or attachments.`);
      await this.markMessagesAsProcessed(sortedGroup, sanitizedChannelName);
    }
  }
}

export default new MessageHandler();
