const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const readline = require('readline');
const config = require('./config'); // Импортируем конфигурацию

const stringSession = new StringSession(''); // Оставь пустым для создания новой сессии

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const askQuestion = (question) => {
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            resolve(answer);
        });
    });
};

(async () => {
    console.log('Loading Telegram client...');

    const client = new TelegramClient(stringSession, config.telegramApiId, config.telegramApiHash, {
        connectionRetries: 5,
    });

    try {
        await client.connect(); // Пробуем подключиться
        console.log('Client connected.');

        await client.start({
            phoneNumber: async () => config.telegramPhoneNumber, // Используем номер из конфигурации
            password: async () => config.telegramPassword, // Используем пароль из конфигурации
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
})();
