import { Api } from 'telegram/tl';
import { getCurrentTime } from './index';

/**
 * Интерфейс для описания сущности в тексте сообщения
 */
interface MessageEntity {
  offset: number;
  length: number;
  type: string;
  url?: string;
}

/**
 * Список доменов, для которых разрешены эмбеды
 */
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

/**
 * Класс для форматирования сообщений из Telegram для Discord
 */
export class MessageFormatter {
  /**
   * Проверяет, разрешен ли эмбед для данного URL
   * @param url URL для проверки
   * @returns true, если эмбед разрешен
   */
  private isEmbedAllowed(url: string): boolean {
    try {
      const urlObj = new URL(url);
      const domain = urlObj.hostname.replace('www.', '');
      return ALLOWED_EMBED_DOMAINS.some(allowedDomain => domain.includes(allowedDomain));
    } catch (error) {
      // Если не удалось распарсить URL, то не разрешаем эмбед
      return false;
    }
  }

  /**
   * Форматирует URL для предотвращения автоматического создания эмбеда
   * @param url URL для форматирования
   * @returns Отформатированный URL
   */
  private formatUrl(url: string): string {
    if (this.isEmbedAllowed(url)) {
      // Для разрешенных доменов оставляем URL как есть
      return url;
    } else {
      // Для других доменов добавляем символ <> чтобы предотвратить создание эмбеда
      // Discord не создает эмбеды для URL-ов в формате <url>
      return `<${url}>`;
    }
  }
  /**
   * Форматирует текст сообщения с учетом сущностей (ссылок, упоминаний и т.д.)
   * @param message Текст сообщения
   * @param entities Сущности сообщения из Telegram
   * @returns Отформатированный текст для Discord
   */
  public formatMessage(message: string, entities?: any[]): string {
    if (!message) return '';
    if (!entities || !entities.length) return message;

    let result = message;
    let offset = 0; // Смещение, возникающее из-за добавления форматирования

    // Сортируем сущности по смещению, чтобы обрабатывать их в правильном порядке
    const sortedEntities = [...entities].sort((a, b) => a.offset - b.offset);

    for (const entity of sortedEntities) {
      try {
        const formattedEntity = this.formatEntity(result, entity, offset);
        result = formattedEntity.text;
        offset = formattedEntity.offset;
      } catch (error) {
        console.error(`[${getCurrentTime()}] Error formatting entity:`, error);
      }
    }

    return result;
  }

  /**
   * Форматирует отдельную сущность в тексте
   */
  private formatEntity(text: string, entity: any, currentOffset: number): { text: string, offset: number } {
    const start = entity.offset + currentOffset;
    const end = start + entity.length;
    
    // Получаем оригинальный текст сущности
    const originalText = text.substring(start, end);
    let formattedText = originalText;
    let newOffset = currentOffset;

    // Обрабатываем различные типы сущностей
    switch (entity.className) {
      case 'MessageEntityTextUrl':
        // Текст с URL форматируем с учетом разрешенных доменов
        const formattedUrl = this.formatUrl(entity.url);
        formattedText = `[${originalText}](${formattedUrl})`;
        break;
      
      case 'MessageEntityUrl':
        // Если это просто URL, форматируем с учетом разрешенных доменов
        if (!originalText.startsWith('http')) {
          formattedText = this.formatUrl(`http://${originalText}`);
        } else {
          formattedText = this.formatUrl(originalText);
        }
        break;
      
      case 'MessageEntityBold':
        // Жирный текст
        formattedText = `**${originalText}**`;
        break;
      
      case 'MessageEntityItalic':
        // Курсив
        formattedText = `*${originalText}*`;
        break;
      
      case 'MessageEntityCode':
        // Код
        formattedText = `\`${originalText}\``;
        break;
      
      case 'MessageEntityPre':
        // Блок кода
        formattedText = `\`\`\`\n${originalText}\n\`\`\``;
        break;
      
      case 'MessageEntityMention':
        // Упоминания @username оставляем как есть
        break;
      
      default:
        // Другие типы сущностей не обрабатываем
        break;
    }

    // Вычи��ляем новое смещение
    const offsetChange = formattedText.length - originalText.length;
    newOffset += offsetChange;

    // Заменяем оригинальный текст отформатированным
    const newText = text.substring(0, start) + formattedText + text.substring(end);

    return { text: newText, offset: newOffset };
  }

  /**
   * Преобразует полученный из Telegram объект сообщения для извлечения текста и сущностей
   */
  public extractMessageContent(message: any): { text: string, entities: any[] } {
    let text = message.message || '';
    let entities: any[] = [];

    if (message.entities) {
      entities = message.entities;
    }

    return { text, entities };
  }
}

export default new MessageFormatter();
