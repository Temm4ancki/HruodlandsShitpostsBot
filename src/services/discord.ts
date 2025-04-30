import { Client, GatewayIntentBits, Partials, TextChannel, AttachmentBuilder, MessageCreateOptions } from 'discord.js';
import config from '../config';
import { getCurrentTime } from '../utils';

export class DiscordService {
  private client: Client;

  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
      ],
      partials: [Partials.Channel],
    });
  }

  /**
   * Инициализирует клиент Discord
   */
  async initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.once('ready', () => {
        console.log(`[${getCurrentTime()}] Discord Client ready.`);
        resolve();
      });

      this.client.login(config.discord.token).catch(reject);
    });
  }

  /**
   * Получает каналы Discord по их ID
   */
  async getChannels(): Promise<TextChannel[]> {
    const channels: TextChannel[] = [];
    
    for (const channelId of config.discord.channelIds) {
      try {
        const channel = await this.client.channels.fetch(channelId) as TextChannel;
        if (channel) {
          channels.push(channel);
        }
      } catch (err) {
        console.error(`[${getCurrentTime()}] Error fetching Discord channel ${channelId}:`, err);
      }
    }
    
    return channels;
  }

  /**
   * Отправляет сообщение со вложениями в Discord каналы
   * @param content Текстовое содержимое сообщения
   * @param attachments Вложения (файлы, изображения, видео)
   * @param allowEmbeds Разрешить ли автоматическое создание эмбедов для ссылок в сообщении
   */
  async sendMessage(
    content: string | null, 
    attachments: AttachmentBuilder[],
    allowEmbeds: boolean = false
  ): Promise<void> {
    const channels = await this.getChannels();
    
    const messageOptions: MessageCreateOptions = {
      content: content || undefined,
      files: attachments,
      // Предотвращаем создание эмбедов, если allowEmbeds = false
      // Примечание: это не влияет на эмбеды ссылок в формате <url>
      embeds: allowEmbeds ? undefined : [],
    };
    
    for (const channel of channels) {
      try {
        await channel.send(messageOptions);
      } catch (err) {
        console.error(`[${getCurrentTime()}] Error sending message to Discord channel:`, err);
      }
    }
  }
}

export default new DiscordService();
