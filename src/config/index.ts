import dotenv from 'dotenv';
import path from 'path';

// Загружаем переменные окружения из .env файла
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

/**
 * Безопасное преобразование строки в число с плавающей точкой
 * @param value Строковое значение
 * @param defaultValue Значение по умолчанию, если преобразование не удалось
 * @returns Число с плавающей точкой
 */
function parseFloat(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  
  // Заменяем запятую на точку (для поддержки разных форматов записи)
  const normalizedValue = value.replace(',', '.');
  
  // Пробуем преобразовать в число
  const parsedValue = Number(normalizedValue);
  
  // Проверяем, является ли результат действительным числом
  return isNaN(parsedValue) ? defaultValue : parsedValue;
}

interface Config {
  telegram: {
    apiId: number;
    apiHash: string;
    sessionString: string;
    phoneNumber: string;
    password: string;
    channelId: number;
    messageLimit: number;
    checkInterval: number;
  };
  discord: {
    token: string;
    channelIds: string[];
    maxFileSize: number; // Максимальный размер файла для Discord в МБ
    targetCompressedSize: number; // Целевой размер сжатого файла в МБ
  };
  storage: {
    maxStoredMessages: number; // Максимальное количество хранимых сообщений
  };
}

const config: Config = {
  telegram: {
    apiId: Number(process.env.TELEGRAM_API_ID),
    apiHash: process.env.TELEGRAM_API_HASH || '',
    sessionString: process.env.TELEGRAM_SESSION_STRING || '',
    phoneNumber: process.env.TELEGRAM_PHONE_NUMBER || '',
    password: process.env.TELEGRAM_PASSWORD || '',
    channelId: Number(process.env.TELEGRAM_CHANNEL_ID),
    messageLimit: Number(process.env.TELEGRAM_MESSAGE_LIMIT) || 20,
    checkInterval: Number(process.env.TELEGRAM_CHECK_INTERVAL) || 30,
  },
  discord: {
    token: process.env.DISCORD_TOKEN || '',
    channelIds: (process.env.DISCORD_CHANNEL_IDS || '').split(',').filter(id => id.trim() !== ''),
    maxFileSize: parseFloat(process.env.DISCORD_MAX_FILE_SIZE, 8.5), // По умолчанию 8.5 МБ
    targetCompressedSize: parseFloat(process.env.DISCORD_TARGET_COMPRESSED_SIZE, 7.5), // По умолчанию 7.5 МБ
  },
  storage: {
    maxStoredMessages: Number(process.env.MAX_STORED_MESSAGES) || 50, // По умолчанию 50 сообщений
  },
};

export default config;
