import * as fs from 'fs';
import * as path from 'path';
import ffmpegPath from 'ffmpeg-static';
import ffmpeg from 'fluent-ffmpeg';
import { getCurrentTime } from '../utils';
import config from '../config';

// Получаем лимиты размера файлов из конфигурации
const MAX_DISCORD_FILE_SIZE = config.discord.maxFileSize * 1024 * 1024; // Конвертируем МБ в байты

// Целевые размеры для многоступенчатого сжатия (в МБ)
// Каждый следующий уровень даёт более сильное сжатие
const COMPRESSION_LEVELS = [
  config.discord.targetCompressedSize,       // Первая попытка - стандартный целевой размер
  config.discord.targetCompressedSize - 0.5, // Вторая попытка - немного меньше
  config.discord.targetCompressedSize - 1.0, // Третья попытка - еще меньше
  config.discord.targetCompressedSize - 1.5, // Четвертая попытка
  config.discord.targetCompressedSize - 2.0, // Пятая попытка
  config.discord.targetCompressedSize * 0.8, // Шестая попытка - 80% от целевого размера
  config.discord.targetCompressedSize * 0.7, // Седьмая попытка - 70% от целевого размера
  config.discord.targetCompressedSize * 0.6  // Последняя попытка - 60% от целевого размера
];

// Уровни качества для сжатия изображений (от 1 до 31, где 1 - лучшее качество)
const IMAGE_QUALITY_LEVELS = [5, 10, 15, 20, 25, 30];

export class MediaProcessor {
  /**
   * Проверяет размер файла
   * @param filePath Путь к файлу
   * @returns Размер файла в байтах
   */
  async getFileSize(filePath: string): Promise<number> {
    try {
      const stats = await fs.promises.stat(filePath);
      return stats.size;
    } catch (error) {
      console.error(`[${getCurrentTime()}] Error getting file size for ${filePath}:`, error);
      return 0;
    }
  }

  /**
   * Проверяет, превышает ли файл максимально допустимый размер для Discord
   * @param filePath Путь к файлу
   * @returns true, если файл превышает лимит
   */
  async isFileTooLarge(filePath: string): Promise<boolean> {
    const fileSize = await this.getFileSize(filePath);
    return fileSize > MAX_DISCORD_FILE_SIZE;
  }

  /**
   * Конвертирует видео из одного формата в другой
   * @param inputPath Путь к исходному файлу
   * @param outputPath Путь к выходному файлу
   * @returns Путь к сконвертированному файлу
   */
  async convertVideo(inputPath: string, outputPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .setFfmpegPath(ffmpegPath as string)
        .toFormat('mp4')
        .on('end', () => {
          console.log(`[${getCurrentTime()}] Conversion finished: ${outputPath}`);
          resolve(outputPath);
        })
        .on('error', (err) => {
          console.error(`[${getCurrentTime()}] Error during conversion:`, err);
          reject(err);
        })
        .save(outputPath);
    });
  }

  /**
   * Сжимает видео до указанного битрейта для уменьшения размера файла
   * @param inputPath Путь к исходному файлу
   * @param outputPath Путь к выходному файлу
   * @param targetSize Желаемый размер файла в МБ
   * @param compressionLevel Уровень качества сжатия (preset)
   * @returns Путь к сжатому файлу
   */
  async compressVideo(
    inputPath: string, 
    outputPath: string, 
    targetSize: number,
    compressionLevel: 'fast' | 'medium' | 'slow' = 'fast'
  ): Promise<string> {
    // Получаем информацию о видео
    const videoInfo = await this.getVideoInfo(inputPath);
    
    // Вычисляем целевой битрейт на основе длительности видео и желаемого размера
    // Формула: (targetSize * 8192) / durationInSeconds = килобит в секунду
    const durationInSeconds = videoInfo.duration;
    
    if (!durationInSeconds || durationInSeconds <= 0) {
      throw new Error('Cannot determine video duration');
    }
    
    // Целевой размер в килобитах
    const targetSizeKb = targetSize * 8 * 1024;
    
    // Вычисляем битрейт (килобит в секунду)
    // Используем 90% от теоретического максимума для учета аудио и метаданных
    const targetBitrate = Math.floor((targetSizeKb / durationInSeconds) * 0.9);
    
    console.log(`[${getCurrentTime()}] Compressing video with target bitrate ${targetBitrate}k for ${durationInSeconds}s duration (target: ${targetSize.toFixed(2)} MB, preset: ${compressionLevel})`);
    
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .setFfmpegPath(ffmpegPath as string)
        .toFormat('mp4')
        .videoBitrate(targetBitrate + 'k')
        .outputOptions('-movflags', 'faststart') // Оптимизация для веб-просмотра
        .outputOptions('-preset', compressionLevel) // Уровень сжатия
        .on('progress', (progress) => {
          if (progress.percent) {
            console.log(`[${getCurrentTime()}] Compression progress: ${Math.round(progress.percent)}%`);
          }
        })
        .on('end', () => {
          console.log(`[${getCurrentTime()}] Compression finished: ${outputPath}`);
          resolve(outputPath);
        })
        .on('error', (err) => {
          console.error(`[${getCurrentTime()}] Error during compression:`, err);
          reject(err);
        })
        .save(outputPath);
    });
  }

  /**
   * Сжимает изображение до указанного качества для уменьшения размера файла
   * @param inputPath Путь к исходному файлу
   * @param outputPath Путь к выходному файлу
   * @param quality Качество изображения (1-31, где 1 - лучшее качество)
   * @returns Путь к сжатому файлу
   */
  async compressImage(inputPath: string, outputPath: string, quality: number = 5): Promise<string> {
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .setFfmpegPath(ffmpegPath as string)
        .outputOptions('-q:v', quality.toString()) // Качество от 1 (лучшее) до 31 (худшее)
        .on('end', () => {
          console.log(`[${getCurrentTime()}] Image compression finished: ${outputPath} with quality ${quality}`);
          resolve(outputPath);
        })
        .on('error', (err) => {
          console.error(`[${getCurrentTime()}] Error during image compression:`, err);
          reject(err);
        })
        .save(outputPath);
    });
  }

  /**
   * Получает информацию о видеофайле (длительность, размеры и т.д.)
   * @param filePath Путь к видеофайлу
   * @returns Объект с информацией о видео
   */
  private getVideoInfo(filePath: string): Promise<{
    duration: number; // в секундах
    width?: number;
    height?: number;
    bitrate?: number;
  }> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) {
          console.error(`[${getCurrentTime()}] Error getting video info:`, err);
          return reject(err);
        }
        
        const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
        
        // Исправление: проверяем тип bit_rate и правильно обрабатываем его
        let bitrate: number | undefined = undefined;
        if (metadata.format.bit_rate) {
          // Если bit_rate - это строка, преобразуем в число, иначе используем как есть
          bitrate = typeof metadata.format.bit_rate === 'string' 
            ? parseInt(metadata.format.bit_rate, 10)
            : metadata.format.bit_rate;
        }
        
        resolve({
          duration: metadata.format.duration || 0,
          width: videoStream?.width,
          height: videoStream?.height,
          bitrate: bitrate
        });
      });
    });
  }

  /**
   * Выполняет многоступенчатое сжатие видео с несколькими попытками
   * @param inputPath Путь к исходному файлу
   * @param outputBasePath Базовый путь для выходных файлов
   * @returns Путь к успешно сжатому файлу или null, если сжатие не удалось
   */
  async multiStageVideoCompression(inputPath: string, outputBasePath: string): Promise<string | null> {
    // Для каждого уровня сжатия пробуем сжать файл
    for (let levelIndex = 0; levelIndex < COMPRESSION_LEVELS.length; levelIndex++) {
      const targetSize = COMPRESSION_LEVELS[levelIndex];
      
      // Выбираем уровень качества сжатия в зависимости от этапа
      let compressionLevel: 'fast' | 'medium' | 'slow';
      if (levelIndex < 3) {
        compressionLevel = 'fast'; // Первые попытки - быстрое сжатие
      } else if (levelIndex < 6) {
        compressionLevel = 'medium'; // Средние попытки - среднее сжатие
      } else {
        compressionLevel = 'slow'; // Последние попытки - медленное, но качественное сжатие
      }
      
      // Создаем путь для текущей попытки сжатия
      const attemptPath = outputBasePath.replace(/\.\w+$/, `_compressed_${levelIndex + 1}$&`);
      
      try {
        // Сжимаем видео с текущими параметрами
        await this.compressVideo(inputPath, attemptPath, targetSize, compressionLevel);
        
        // Проверяем размер после сжатия
        const compressedSize = await this.getFileSize(attemptPath);
        const compressedSizeMB = compressedSize / (1024 * 1024);
        console.log(`[${getCurrentTime()}] Compressed file (attempt ${levelIndex + 1}): ${compressedSizeMB.toFixed(2)} MB (target: ${targetSize.toFixed(2)} MB)`);
        
        // Если размер меньше лимита Discord - возвращаем успешный результат
        if (compressedSize <= MAX_DISCORD_FILE_SIZE) {
          console.log(`[${getCurrentTime()}] Successfully compressed file to fit Discord limit at attempt ${levelIndex + 1}`);
          return attemptPath;
        }
      } catch (error) {
        console.error(`[${getCurrentTime()}] Error during compression attempt ${levelIndex + 1}:`, error);
        // Продолжаем со следующим уровнем сжатия
      }
    }
    
    // Если мы дошли до этого места, значит все попытки сжатия не дали нужного результата
    return null;
  }

  /**
   * Выполняет многоступенчатое сжатие изображения с несколькими попытками
   * @param inputPath Путь к исходному файлу
   * @param outputBasePath Базовый путь для выходных файлов
   * @returns Путь к успешно сжатому файлу или null, если сжатие не удалось
   */
  async multiStageImageCompression(inputPath: string, outputBasePath: string): Promise<string | null> {
    for (let i = 0; i < IMAGE_QUALITY_LEVELS.length; i++) {
      const quality = IMAGE_QUALITY_LEVELS[i];
      const attemptPath = outputBasePath.replace(/\.\w+$/, `_compressed_${i + 1}$&`);
      
      try {
        // Сжимаем изображение с текущим качеством
        await this.compressImage(inputPath, attemptPath, quality);
        
        // Проверяем размер после сжатия
        const compressedSize = await this.getFileSize(attemptPath);
        const compressedSizeMB = compressedSize / (1024 * 1024);
        console.log(`[${getCurrentTime()}] Compressed image (quality ${quality}): ${compressedSizeMB.toFixed(2)} MB`);
        
        // Если размер меньше лимита Discord - возвращаем успешный результат
        if (compressedSize <= MAX_DISCORD_FILE_SIZE) {
          console.log(`[${getCurrentTime()}] Successfully compressed image to fit Discord limit with quality ${quality}`);
          return attemptPath;
        }
      } catch (error) {
        console.error(`[${getCurrentTime()}] Error during image compression with quality ${quality}:`, error);
        // Продолжаем со следующим уровнем качества
      }
    }
    
    // Если мы дошли до этого места, значит все попытки сжатия не дали нужного результата
    return null;
  }

  /**
   * Обрабатывает медиа-файл для Discord с учетом ограничений размера
   * @param inputPath Путь к исходному файлу
   * @param outputPath Путь к выходному файлу
   * @param fileType Тип файла ('video' или 'image')
   * @returns Путь к обработанному файлу, готовому для отправки в Discord
   */
  async processMediaForDiscord(
    inputPath: string, 
    outputPath: string, 
    fileType: 'video' | 'image'
  ): Promise<string> {
    try {
      // Сначала выполняем базовую конвертацию
      let processedPath = outputPath;
      
      if (fileType === 'video') {
        await this.convertVideo(inputPath, outputPath);
      } else {
        // Для изображений просто копируем файл
        fs.copyFileSync(inputPath, outputPath);
      }
      
      // Проверяем, не превышает ли файл лимит Discord
      const fileSize = await this.getFileSize(processedPath);
      if (fileSize > MAX_DISCORD_FILE_SIZE) {
        const fileSizeMB = fileSize / (1024 * 1024);
        console.log(`[${getCurrentTime()}] File ${processedPath} exceeds Discord size limit (${fileSizeMB.toFixed(2)} MB > ${config.discord.maxFileSize.toFixed(2)} MB), starting multi-stage compression...`);
        
        // Запускаем многоступенчатое сжатие в зависимости от типа файла
        let compressedPath: string | null = null;
        
        if (fileType === 'video') {
          compressedPath = await this.multiStageVideoCompression(inputPath, outputPath);
        } else {
          compressedPath = await this.multiStageImageCompression(inputPath, outputPath);
        }
        
        // Если ни одна из попыток сжатия не удалась
        if (!compressedPath) {
          throw new Error(
            `Failed to compress file to fit Discord size limit (${config.discord.maxFileSize} MB) after multiple attempts. ` + 
            `Original file size: ${fileSizeMB.toFixed(2)} MB`
          );
        }
        
        return compressedPath;
      }
      
      return processedPath;
    } catch (error) {
      console.error(`[${getCurrentTime()}] Error processing media for Discord:`, error);
      throw error;
    }
  }

  /**
   * Сохраняет буфер в файл
   */
  saveBufferToFile(buffer: Buffer, filePath: string): void {
    fs.writeFileSync(filePath, buffer);
  }
}

export default new MediaProcessor();
