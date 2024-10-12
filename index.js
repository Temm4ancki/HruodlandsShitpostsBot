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

// Объект для хранения информации о проверенных папках
const checkedDirectories = new Set();

// Функция для создания папки с названием телеграм-канала, если она не существует
async function ensureChannelDirectoryExistence(channelName) {
    const channelDir = path.join(__dirname, 'media', channelName);

    // Проверяем, была ли эта папка уже проверена
    if (checkedDirectories.has(channelDir)) {
        return; // Если проверена, ничего не делаем
    }

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

    // Добавляем директорию в Set, чтобы не проверять её снова
    checkedDirectories.add(channelDir);
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

// Функция для проверки, было ли сообщение уже обработано
    function isMessageProcessed(messageId, channelName) {
        const processedFilePath = path.join(__dirname, 'media', channelName, `${messageId}.processed`);
        return fs.existsSync(processedFilePath); // Возвращает true, если файл .processed существует
    }

// Функция для пометки сообщения как обработанного
    function markMessageAsProcessed(messageId, channelName) {
        const processedFilePath = path.join(__dirname, 'media', channelName, `${messageId}.processed`);
        fs.writeFileSync(processedFilePath, 'processed'); // Создаёт файл с меткой о том, что сообщение обработано
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

// Функция для обработки новых сообщений в Telegram канале
    async function handleNewMessages() {
        try {
            const lastProcessedMessageId = getLastProcessedMessageId();
            const channelName = await getChannelName(config.telegramChannelId);
            const sanitizedChannelName = channelName.replace(/'/g, ""); // Убираем апострофы из названия
            const messages = await telegramClient.invoke(
                new Api.messages.GetHistory({
                    peer: config.telegramChannelId,
                    limit: 10,
                    offsetDate: new Date().getTime() / 1000,
                    offsetId: lastProcessedMessageId || 0,
                    addOffset: lastProcessedMessageId ? 1 : 0,
                })
            );

            const mediaDir = path.join(__dirname, 'media', sanitizedChannelName);
            await ensureChannelDirectoryExistence(sanitizedChannelName);

            for (const message of messages.messages) {
                // Проверяем, было ли сообщение уже обработано
                if (isMessageProcessed(message.id, sanitizedChannelName)) {
                    if (!loggedProcessedMessages.has(message.id)) {
                        console.log(`[${getCurrentTime()}] Message ${message.id} already processed.`);
                        loggedProcessedMessages.add(message.id);
                    }
                    continue; // Пропускаем сообщение, если оно уже обработано
                }

                if (message.media) {
                    const media = message.media;
                    let filePath;
                    let buffer;

                    if (media.className === 'MessageMediaPhoto') {
                        filePath = path.join(mediaDir, `${message.id}.jpg`);
                        buffer = await telegramClient.downloadMedia(media);

                        if (buffer) {
                            console.log(`[${getCurrentTime()}] Downloaded photo size: ${buffer.length} bytes`);
                            fs.writeFileSync(filePath, buffer);

                            // Проверяем, существует ли файл после сохранения
                            if (fs.existsSync(filePath)) {
                                console.log(`[${getCurrentTime()}] Photo saved successfully: ${filePath}`);
                            } else {
                                console.error(`[${getCurrentTime()}] Photo file not found after saving: ${filePath}`);
                                continue; // Пропускаем обработку этого сообщения, если файл не найден
                            }
                        } else {
                            console.error(`[${getCurrentTime()}] Error downloading photo media: ${filePath}`);
                            continue; // Пропускаем обработку этого сообщения в случае ошибки загрузки
                        }
                    } else if (media.className === 'MessageMediaDocument' && media.document.mimeType.startsWith('video/')) {
                        const originalFilePath = path.join(mediaDir, `${message.id}.mp4`);
                        buffer = await telegramClient.downloadMedia(media);

                        if (buffer) {
                            console.log(`[${getCurrentTime()}] Downloaded video size: ${buffer.length} bytes`);
                            fs.writeFileSync(originalFilePath, buffer);

                            // Проверяем, существует ли файл после сохранения
                            if (fs.existsSync(originalFilePath)) {
                                console.log(`[${getCurrentTime()}] Original video saved: ${originalFilePath}`);
                                const convertedFilePath = path.join(mediaDir, `${message.id}_converted.mp4`);
                                await convertVideo(originalFilePath, convertedFilePath);

                                // Проверяем, существует ли файл после конвертации
                                if (fs.existsSync(convertedFilePath)) {
                                    filePath = convertedFilePath;
                                    console.log(`[${getCurrentTime()}] Converted video saved: ${filePath}`);
                                } else {
                                    console.error(`[${getCurrentTime()}] Converted video not found: ${convertedFilePath}`);
                                    continue; // Пропускаем обработку этого сообщения, если файл не найден
                                }
                            } else {
                                console.error(`[${getCurrentTime()}] Original video file not found after saving: ${originalFilePath}`);
                                continue; // Пропускаем обработку этого сообщения, если файл не найден
                            }
                        } else {
                            console.error(`[${getCurrentTime()}] Error downloading video media: ${originalFilePath}`);
                            continue; // Пропускаем обработку этого сообщения в случае ошибки загрузки
                        }
                    }

                    // Если файл существует, отправляем его в Discord
                    if (filePath && fs.existsSync(filePath)) {
                        const discordChannels = await Promise.all(config.discordChannelIds.map(async (channelId) => {
                            try {
                                return await discordClient.channels.fetch(channelId);
                            } catch (err) {
                                console.error(`[${getCurrentTime()}] Error fetching Discord channel ${channelId}:`, err);
                                return null;
                            }
                        }));

                        let sentSuccessfully = false; // Флаг для отслеживания успешной отправки

                        for (const discordChannel of discordChannels) {
                            if (discordChannel) {
                                try {
                                    const attachment = new AttachmentBuilder(filePath);
                                    await discordChannel.send({ files: [attachment] });
                                    sentSuccessfully = true; // Установим флаг, если отправка успешна
                                } catch (err) {
                                    console.error(`[${getCurrentTime()}] Error sending file to Discord channel:`, err);
                                }
                            }
                        }

                        // Помечаем сообщение как обработанное только после успешной отправки
                        if (sentSuccessfully) {
                            markMessageAsProcessed(message.id, sanitizedChannelName);
                            console.log(`[${getCurrentTime()}] Message ${message.id} marked as processed.`);
                        } else {
                            console.error(`[${getCurrentTime()}] Failed to send message ${message.id} to Discord.`);
                        }
                    } else {
                        console.error(`[${getCurrentTime()}] File not found after processing: ${filePath}`);
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