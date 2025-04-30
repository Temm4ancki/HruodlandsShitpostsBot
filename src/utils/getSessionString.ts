import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import * as readline from 'readline';
import config from '../config';

/**
 * Утилита для получения строки сессии Telegram
 */
async function getSessionString(): Promise<void> {
  const stringSession = new StringSession(''); // Пустая строка для создания новой сессии

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const askQuestion = (question: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(question, (answer) => {
        resolve(answer);
      });
    });
  };

  console.log('Loading Telegram client...');

  const client = new TelegramClient(stringSession, config.telegram.apiId, config.telegram.apiHash, {
    connectionRetries: 5,
  });

  try {
    await client.connect(); // Пробуем подключиться
    console.log('Client connected.');

    await client.start({
      phoneNumber: async () => config.telegram.phoneNumber, // Используем номер из конфигурации
      password: async () => config.telegram.password, // Используем пароль из конфигурации
      phoneCode: async () => await askQuestion('Please enter the code you received: '),
      onError: (err) => console.log('Error during start:', err),
    });

    console.log('You are now connected.');
    console.log('Your Session String:');
    console.log(client.session.save()); // Сохраняет и выводит StringSession
  } catch (error) {
    console.log('Failed to connect or start the client:', error);
  } finally {
    rl.close(); // Закрываем интерфейс readline
  }
}

// Запуск функции, если файл запущен напрямую
if (require.main === module) {
  getSessionString().catch(console.error);
}

export default getSessionString;