import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { Api } from 'telegram/tl';
import * as readline from 'readline';
import config from '../config';
import { getCurrentTime } from '../utils';

export class TelegramService {
  private client: TelegramClient;

  constructor() {
    this.client = new TelegramClient(
      new StringSession(config.telegram.sessionString),
      config.telegram.apiId,
      config.telegram.apiHash,
      {
        connectionRetries: 5,
      }
    );
  }

  /**
   * Инициализирует клиент Telegram
   */
  async initialize(): Promise<void> {
    console.log(`[${getCurrentTime()}] Loading Telegram Client...`);
    await this.client.start({
      phoneNumber: async () => config.telegram.phoneNumber,
      password: async () => config.telegram.password,
      phoneCode: async () => {
        console.log(`[${getCurrentTime()}] Please enter the code you received:`);
        
        // Используем readline интерфейс вместо process.openStdin()
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout
        });
        
        const code = await new Promise<string>((resolve) => {
          rl.question('', (answer: string) => {
            rl.close();
            resolve(answer.trim());
          });
        });
        
        return code;
      },
      onError: (err) => console.log(err),
    });
    console.log(`[${getCurrentTime()}] Telegram Client loaded.`);
  }

  /**
   * Получает имя канала по его ID
   */
  async getChannelName(channelId: number): Promise<string> {
    const result = await this.client.invoke(
      new Api.channels.GetFullChannel({
        channel: channelId,
      })
    );
    
    // Добавляем проверку и приведение типов
    if (result.chats && result.chats.length > 0 && 'title' in result.chats[0]) {
      return result.chats[0].title as string;
    }
    
    // Возвращаем значение по умолчанию, если название канала не найдено
    return 'Unknown Channel';
  }

  /**
   * Получает историю сообщений из канала
   */
  async getHistory(channelId: number, limit: number, lastProcessedMessageId: number = 0): Promise<any> {
    return await this.client.invoke(
      new Api.messages.GetHistory({
        peer: channelId,
        limit: limit,
        offsetDate: Math.floor(new Date().getTime() / 1000),
        offsetId: lastProcessedMessageId || 0,
        addOffset: lastProcessedMessageId ? 1 : 0,
      })
    );
  }

  /**
   * Скачивает медиа-контент из сообщения
   */
  async downloadMedia(media: any): Promise<Buffer | null> {
    try {
      const downloadedMedia = await this.client.downloadMedia(media);
      
      // Проверяем и приводим к нужному типу
      if (downloadedMedia instanceof Buffer) {
        return downloadedMedia;
      } else if (typeof downloadedMedia === 'string') {
        // Если вернулась строка, преобразуем её в Buffer
        return Buffer.from(downloadedMedia);
      }
      
      // Если не удалось скачать медиа или преобразовать его в Buffer
      return null;
    } catch (error) {
      console.error(`[${getCurrentTime()}] Error downloading media:`, error);
      return null;
    }
  }
}

export default new TelegramService();
