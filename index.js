const ffmpegPath = require('ffmpeg-static');
const ffmpeg = require('fluent-ffmpeg');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram/tl');
const { Client, GatewayIntentBits, Partials, AttachmentBuilder } = require('discord.js');
const config = require('./config.js');
const fs = require('fs');
const path = require('path');

// Функция для конвертации видео в нужный формат
async function convertVideo(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .setFfmpegPath(ffmpegPath) // Указываем путь к ffmpeg
            .toFormat('mp4') // Укажите нужный формат
            .on('end', () => {
                console.log(`[${getCurrentTime()}] Conversion finished: ${outputPath}`);
                resolve(outputPath);
            })
            .on('error', (err) => {
                console.error(`[${getCurrentTime()}] Error during conversion:`, err);
                reject(err);
            })
            .save(outputPath); // Укажите выходной файл
    });
}

// Функция для получения текущего времени в формате HH:MM
function getCurrentTime() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

// Функция для создания папки с названием телеграм-канала, если она не существует
async function ensureChannelDirectoryExistence(channelName) {
    const channelDir = path.join(__dirname, 'media', channelName);
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
}

// Инициализация Telegram Client
const telegramClient = new TelegramClient(new StringSession(config.telegramSessionString), config.telegramApiId, config.telegramApiHash, {
    connectionRetries: 5,
});

(async () => {
    console.log(`[${getCurrentTime()}] Loading Telegram Client...`);
    await telegramClient.start({
        phoneNumber: async () => config.telegramPhoneNumber,
        password: async () => config.telegramPassword,
        phoneCode: async () => {
            console.log(`[${getCurrentTime()}] Please enter the code you received:`);
            const code = await new Promise((resolve) => {
                const stdin = process.openStdin();
                stdin.addListener('data', (d) => {
                    resolve(d.toString().trim());
                });
            });
            return code;
        },
        onError: (err) => console.log(err),
    });
    console.log(`[${getCurrentTime()}] Telegram Client loaded.`);

    // Инициализация Discord Client с указанием Intents
    const discordClient = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.GuildMessageReactions,
        ],
        partials: [Partials.Channel],
    });

    discordClient.once('ready', () => {
        console.log(`[${getCurrentTime()}] Discord Client ready.`);
    });

    discordClient.login(config.discordToken);

    // Функция для получения количества сообщений в Telegram канале
    async function getMessageCount(channelId) {
        const result = await telegramClient.invoke(
            new Api.channels.GetFullChannel({
                channel: channelId,
            })
        );
        return result.fullChat.participantsCount;
    }

    // Команда Discord для получения количества сообщений
    discordClient.on('messageCreate', async (message) => {
        if (message.content === '!countMessages') {
            try {
                const messageCount = await getMessageCount(config.telegramChannelId);
                message.channel.send(`In the Telegram channel ${config.telegramChannelId} ${messageCount} messages.`);
            } catch (err) {
                console.error(err);
                message.channel.send('Error getting count of messages.');
            }
        }
    });

    // Функция для проверки, было ли сообщение уже обработано
    function isMessageProcessed(messageId, channelName) {
        const processedFilePath = path.join(__dirname, 'media', channelName, `${messageId}.processed`);
        return fs.existsSync(processedFilePath);
    }

    // Функция для пометки сообщения как обработанного
    function markMessageAsProcessed(messageId, channelName) {
        const processedFilePath = path.join(__dirname, 'media', channelName, `${messageId}.processed`);
        fs.writeFileSync(processedFilePath, 'processed');
    }

    // Функция для получения имени канала
    async function getChannelName(channelId) {
        const result = await telegramClient.invoke(
            new Api.channels.GetFullChannel({
                channel: channelId,
            })
        );
        return result.chats[0].title;
    }

    // Набор для отслеживания сообщений, которые были залогированы как проверенные
    const loggedProcessedMessages = new Set();

    // Функция для обработки новых сообщений в Telegram канале
    async function convertVideo(inputPath, outputPath) {
        return new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                .setFfmpegPath(ffmpegPath) // Указываем путь к ffmpeg
                .toFormat('mp4') // Укажите нужный формат
                .on('end', () => {
                    console.log(`[${getCurrentTime()}] Conversion finished: ${outputPath}`);
                    resolve(outputPath);
                })
                .on('error', (err) => {
                    console.error(`[${getCurrentTime()}] Error during conversion:`, err);
                    reject(err);
                })
                .save(outputPath); // Укажите выходной файл
        });
    }

// Изменяем часть кода в функции handleNewMessages
    async function handleNewMessages() {
        try {
            const lastProcessedMessageId = getLastProcessedMessageId();
            const channelName = await getChannelName(config.telegramChannelId);
            const messages = await telegramClient.invoke(
                new Api.messages.GetHistory({
                    peer: config.telegramChannelId,
                    limit: 10,
                    offsetDate: new Date().getTime() / 1000,
                    offsetId: lastProcessedMessageId || 0,
                    addOffset: lastProcessedMessageId ? 1 : 0,
                })
            );

            await ensureChannelDirectoryExistence(channelName);

            for (const message of messages.messages) {
                if (isMessageProcessed(message.id, channelName)) {
                    if (!loggedProcessedMessages.has(message.id)) {
                        console.log(`[${getCurrentTime()}] Message ${message.id} already processed.`);
                        loggedProcessedMessages.add(message.id);
                    }
                    continue; // Сообщение уже обработано, пропускаем его
                }

                if (message.media) {
                    const media = message.media;
                    let filePath;
                    let buffer;

                    const mediaDir = path.join(__dirname, 'media', channelName);

                    if (media.className === 'MessageMediaPhoto') {
                        filePath = path.join(mediaDir, `${message.id}.jpg`);
                        buffer = await telegramClient.downloadMedia(media);
                    } else if (media.className === 'MessageMediaDocument' && media.document.mimeType.startsWith('video/')) {
                        const originalFilePath = path.join(mediaDir, `${message.id}.mp4`);
                        buffer = await telegramClient.downloadMedia(media);
                        fs.writeFileSync(originalFilePath, buffer);
                        console.log(`[${getCurrentTime()}] Original video saved: ${originalFilePath}`);

                        // Конвертируем видео перед отправкой
                        const convertedFilePath = path.join(mediaDir, `${message.id}_converted.mp4`);
                        await convertVideo(originalFilePath, convertedFilePath);
                        filePath = convertedFilePath;
                    }

                    if (filePath) {
                        // Получение всех Discord каналов по их идентификаторам
                        const discordChannels = await Promise.all(config.discordChannelIds.map(async (channelId) => {
                            try {
                                return await discordClient.channels.fetch(channelId);
                            } catch (err) {
                                console.error(`[${getCurrentTime()}] Error fetching Discord channel ${channelId}:`, err);
                                return null;
                            }
                        }));

                        for (const discordChannel of discordChannels) {
                            if (discordChannel) {
                                const attachment = new AttachmentBuilder(filePath);
                                await discordChannel.send({ files: [attachment] });
                            }
                        }

                        markMessageAsProcessed(message.id, channelName); // Помечаем сообщение как обработанное
                    }
                }
            }
        } catch (err) {
            console.error(`[${getCurrentTime()}] Error receiving messages:`, err);
        }
    }

    // Получение ID последнего обработанного сообщения
    function getLastProcessedMessageId() {
        // Здесь должен быть ваш код для чтения ID последнего обработанного сообщения из файла или базы данных
        // Возвращаем 0, если нет предыдущего обработанного сообщения
        return 0;
    }

    // Проверка новых сообщений при старте
    await handleNewMessages();

    // Запуск функции для обработки новых сообщений
    setInterval(handleNewMessages, 60000); // Проверка новых сообщений каждые 60 секунд

})();

