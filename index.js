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
                    limit: config.telegramMessageLimit, // Используем настраиваемый лимит
                    offsetDate: new Date().getTime() / 1000,
                    offsetId: lastProcessedMessageId || 0,
                    addOffset: lastProcessedMessageId ? 1 : 0,
                })
            );

            const mediaDir = path.join(__dirname, 'media', sanitizedChannelName);
            await ensureChannelDirectoryExistence(sanitizedChannelName);

            // Сортируем сообщения по дате для корректной обработки
            const sortedMessages = messages.messages.sort((a, b) => a.date - b.date);

            let group = []; // Временное хранилище для сообщений одной группы
            let previousMessageTime = null;

            for (const message of sortedMessages) {
                if (isMessageProcessed(message.id, sanitizedChannelName)) continue;

                const currentMessageTime = message.date; // Время отправки текущего сообщения

                // Проверяем разницу по времени
                if (
                    previousMessageTime !== null &&
                    Math.abs(currentMessageTime - previousMessageTime) > 5 // Разница > 5 секунд — новая группа
                ) {
                    await processMessageGroup(group, sanitizedChannelName, mediaDir); // Обрабатываем текущую группу
                    group = []; // Начинаем новую группу
                }

                group.push(message); // Добавляем сообщение в группу
                previousMessageTime = currentMessageTime; // Обновляем время
            }

            // Обрабатываем последнюю группу, если она есть
            if (group.length > 0) {
                await processMessageGroup(group, sanitizedChannelName, mediaDir);
            }
        } catch (err) {
            console.error(`[${getCurrentTime()}] Error receiving messages:`, err);
        }
    }


// Обработка группы сообщений
    async function processMessageGroup(group, sanitizedChannelName, mediaDir) {
        // Сортируем сообщения в группе по ID (или date) для сохранения оригинального порядка
        const sortedGroup = group.sort((a, b) => a.id - b.id);

        const attachments = [];
        let combinedText = ""; // Объединённый текст всех сообщений

        for (const message of sortedGroup) {
            if (message.message) combinedText += message.message + "\n";

            if (message.media) {
                const media = message.media;
                if (media.className === "MessageMediaPhoto") {
                    const filePath = path.join(mediaDir, `${message.id}.jpg`);
                    const buffer = await telegramClient.downloadMedia(media);
                    if (buffer) {
                        fs.writeFileSync(filePath, buffer);
                        attachments.push(new AttachmentBuilder(filePath));
                    }
                } else if (media.className === "MessageMediaDocument" && media.document.mimeType.startsWith("video/")) {
                    const originalFilePath = path.join(mediaDir, `${message.id}.mp4`);
                    const buffer = await telegramClient.downloadMedia(media);
                    if (buffer) {
                        fs.writeFileSync(originalFilePath, buffer);

                        const convertedFilePath = path.join(mediaDir, `${message.id}_converted.mp4`);
                        await convertVideo(originalFilePath, convertedFilePath);
                        attachments.push(new AttachmentBuilder(convertedFilePath));
                    }
                }
            }
        }

        // Отправляем текст и все медиа в Discord
        if (attachments.length > 0 || combinedText.trim()) {
            const discordChannels = await Promise.all(
                config.discordChannelIds.map((channelId) =>
                    discordClient.channels.fetch(channelId).catch((err) => {
                        console.error(`[${getCurrentTime()}] Error fetching Discord channel ${channelId}:`, err);
                        return null;
                    })
                )
            );

            for (const discordChannel of discordChannels) {
                if (discordChannel) {
                    try {
                        await discordChannel.send({
                            content: combinedText.trim() || null,
                            files: attachments,
                        });
                    } catch (err) {
                        console.error(`[${getCurrentTime()}] Error sending message to Discord channel:`, err);
                    }
                }
            }
        }

        // Помечаем все сообщения в группе как обработанные
        for (const message of sortedGroup) {
            markMessageAsProcessed(message.id, sanitizedChannelName);
            console.log(`[${getCurrentTime()}] Message ${message.id} marked as processed.`);
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