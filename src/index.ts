import telegramService from './services/telegram';
import discordService from './services/discord';
import messageHandler from './services/messageHandler';
import config from './config';
import { getCurrentTime } from './utils';

(async () => {
  try {
    // Инициализация Telegram клиента
    await telegramService.initialize();
    
    // Инициализация Discord клиента
    await discordService.initialize();
    
    // Проверка новых сообщений при старте
    await messageHandler.handleNewMessages();
    
    // Запуск интервала проверки новых сообщений
    setInterval(
      () => messageHandler.handleNewMessages(), 
      config.telegram.checkInterval * 1000
    );
    
    console.log(`[${getCurrentTime()}] Bot started successfully!`);
    console.log(`[${getCurrentTime()}] Checking for new messages every ${config.telegram.checkInterval} seconds.`);
  } catch (error) {
    console.error(`[${getCurrentTime()}] Failed to start the bot:`, error);
    process.exit(1);
  }
})();