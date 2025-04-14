require('dotenv').config();
const {
  Bot,
  GrammyError,
  session,
  HttpError,
  InlineKeyboard,
} = require('grammy');
const { google } = require('googleapis');
const { OAuth2 } = google.auth;
// const nodemailer = require('nodemailer');
const { freeStorage } = require('@grammyjs/storage-free');
const express = require('express');
const app = express();
const PORT = process.env.PORT || 8080;
// Initialize the bot
const bot = new Bot(process.env.BOT_API_KEY);



const oAuth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI
);
oAuth2Client.setCredentials({ refresh_token: process.env.REFRESH_TOKEN });
const calendar = google.calendar({
  version: 'v3',
  auth: oAuth2Client,
});
// Session setup for maintaining conversation state
bot.use(
  session({
    initial: () => ({
      step: 'idle',
      clientName: '',
      contactInfo: '',
      appointmentName: '',
      cabinet: '',
      date: '',
      startTime: '',
      timeSlot: '',
      customTime: '',
    }),
  })
);
// // ////////////////////////////////
bot.api.setMyCommands([
  { command: 'start', description: 'Получить информацию о пространстве.' },
  { command: 'info', description: 'Расскажу о помещениях' },
  { command: 'book', description: 'Арендовать пространство' },
]);
// Helper function to check if time slot is available
async function isTimeSlotAvailable(date, startTime, endTime, cabinet) {
  try {
    // Format date and times for Google Calendar
    const timeZone = 'Europe/Moscow'; // Adjust to your timezone
    // Convert DD/MM/YYYY to YYYY-MM-DD for Google Calendar
    const [day, month, year] = date.split('/');
    const dateStr = `${year}-${month}-${day}`;
    const startDateTime = new Date(`${dateStr}T${startTime}:00`);
    const endDateTime = new Date(`${dateStr}T${endTime}:00`);

    // Create cabinet-specific ID suffix for the summary field to differentiate events
    const cabinetSuffix =
      cabinet === 'cabinet13' ? '[Кабинет 13м²]' : '[Зал 17м²]';

    // Get events from Google Calendar for the specified day
    const response = await calendar.events.list({
      calendarId: process.env.CALENDAR_ID,
      timeMin: new Date(`${dateStr}T00:00:00`).toISOString(),
      timeMax: new Date(`${dateStr}T23:59:59`).toISOString(),
      timeZone,
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = response.data.events || [];

    // Check for overlapping events for the specified cabinet
    for (const event of events) {
      // Skip events that don't have a summary or aren't for the specified cabinet
      if (!event.summary || !event.summary.includes(cabinetSuffix)) continue;

      const eventStart = new Date(event.start.dateTime || event.start.date);
      const eventEnd = new Date(event.end.dateTime || event.end.date);

      // Check if there's an overlap
      if (
        (startDateTime >= eventStart && startDateTime < eventEnd) ||
        (endDateTime > eventStart && endDateTime <= eventEnd) ||
        (startDateTime <= eventStart && endDateTime >= eventEnd)
      ) {
        return false; // Overlap found
      }
    }

    return true; // No overlap, slot is available
  } catch (error) {
    console.error('Error checking time slot availability:', error);
    return false; // Default to unavailable on error
  }
}

// Helper function to send Telegram notification to admin
async function sendTelegramNotification(sessionData) {
  const {
    clientName,
    contactInfo,
    appointmentName,
    cabinet,
    date,
    startTime,
    timeSlot,
    customTime,
  } = sessionData;

  let timeInfo;
  if (timeSlot === 'wholeDay') {
    timeInfo = 'Весь день';
  } else if (timeSlot === 'custom') {
    timeInfo = `Время: ${customTime}`;
  } else {
    let duration;
    if (timeSlot === '1hour') {
      duration = '1 час';
    } else if (timeSlot === '1.5hours') {
      duration = '1.5 часа';
    } else if (timeSlot === '2hours') {
      duration = '2 часа';
    }

    timeInfo = `Начало: ${startTime}, Продолжительность: ${duration}`;
  }

  const cabinetName = cabinet === 'cabinet13' ? 'Кабинет 13м²' : 'Зал 17м²';

  const message = `
🔔 *Новое бронирование ожидает подтверждения и оплаты*

👤 *Имя клиента:* ${clientName}
📞 *Контакт:* ${contactInfo}
📝 *Название:* ${appointmentName}
🏢 *Помещение:* ${cabinetName}
📅 *Дата:* ${date}
⏰ *Время:* ${timeInfo}
  `;

  try {
    await bot.api.sendMessage(process.env.ADMIN_TELEGRAM_ID, message, {
      parse_mode: 'Markdown',
    });
    console.log('Admin notification sent successfully');
  } catch (error) {
    console.error('Error sending admin notification:', error);
  }
}

// Helper function to add event to Google Calendar
async function addEventToCalendar(sessionData) {
  const {
    clientName,
    // contactInfo,
    appointmentName,
    cabinet,
    date,
    startTime,
    timeSlot,
    customTime,
  } = sessionData;

  // Determine start and end times based on timeSlot
  let eventStartTime, eventEndTime;
  const timeZone = 'Europe/Moscow'; // Adjust to your timezone

  // Convert DD/MM/YYYY to YYYY-MM-DD for Google Calendar
  const [day, month, year] = date.split('/');
  const googleCalendarDate = `${year}-${month}-${day}`;

  // Set color based on cabinet
  const colorId = cabinet === 'cabinet13' ? '11' : '6'; // 11=red, 6=orange

  if (timeSlot === 'wholeDay') {
    // For whole day events
    return calendar.events.insert({
      calendarId: process.env.CALENDAR_ID,
      resource: {
        summary: `${appointmentName} - ${clientName} ${
          cabinet === 'cabinet13' ? '[Кабинет 13м²]' : '[Зал 17м²]'
        }`,
        description: `\nИмя клиента: ${clientName}\nНазвание мероприятия: ${appointmentName}`,
        start: {
          date: googleCalendarDate,
        },
        end: {
          date: googleCalendarDate,
        },
        colorId: colorId,
      },
    });
  } else if (timeSlot === 'custom') {
    // For custom time slots
    [eventStartTime, eventEndTime] = customTime.split('-').map(t => t.trim());
  } else {
    // For predefined time slots
    eventStartTime = startTime;

    // Calculate end time based on duration
    const startDate = new Date(`${googleCalendarDate}T${eventStartTime}:00`);
    let hours = 0;

    if (timeSlot === '1hour') {
      hours = 1;
    } else if (timeSlot === '1.5hours') {
      hours = 1.5;
    } else if (timeSlot === '2hours') {
      hours = 2;
    }

    const endDate = new Date(startDate.getTime() + hours * 60 * 60 * 1000);
    eventEndTime = `${endDate.getHours().toString().padStart(2, '0')}:${endDate
      .getMinutes()
      .toString()
      .padStart(2, '0')}`;
  }

  // Add event to Google Calendar
  return calendar.events.insert({
    calendarId: process.env.CALENDAR_ID,
    resource: {
      summary: `${appointmentName} - ${clientName} ${
        cabinet === 'cabinet13' ? '[Кабинет 13м²]' : '[Зал 17м²]'
      }`,
      description: `\nИмя клиента: ${clientName}\nНазвание мероприятия: ${appointmentName}`,
      start: {
        dateTime: `${googleCalendarDate}T${eventStartTime}:00`,
        timeZone,
      },
      end: {
        dateTime: `${googleCalendarDate}T${eventEndTime}:00`,
        timeZone,
      },
      colorId: colorId,
    },
  });
}

// Generate time selection keyboard (9:00 to 22:00)
function generateTimeKeyboard() {
  const keyboard = new InlineKeyboard();
  const hours = [];

  for (let i = 9; i <= 22; i++) {
    const hour = i.toString().padStart(2, '0') + ':00';
    hours.push({ text: hour, callback_data: hour });
  }

  // Create rows with 4 buttons each
  for (let i = 0; i < hours.length; i += 4) {
    const row = hours.slice(i, i + 4);
    keyboard.row();
    for (const hourBtn of row) {
      keyboard.text(hourBtn.text, hourBtn.callback_data);
    }
  }

  return keyboard;
}

// Start command
bot.command('book', async ctx => {
  ctx.session = {
    step: 'askName',
    clientName: '',
    contactInfo: '',
    appointmentName: '',
    cabinet: '',
    date: '',
    startTime: '',
    timeSlot: '',
    customTime: '',
  };

  await ctx.reply(
    'Вы начали процесс бронирования кабинетов! Обязательно посмотри свободные слоты в <a href="https://dushepolezno.ru/prostranstvo-zapis">расписании</a>. Сейчас я задам вам несколько вопросов о вашем мероприятии, чтобы передать эту информацию менеджеру. Для начала, введите ваше имя.',
    { parse_mode: 'HTML' }
  );
});
bot.command('start', async ctx => {
  // await ctx.react('👌');
  await ctx.reply(
    'Привет! я бот для аренды Простраства. Мы открыты с 9 до 22 и работаем без выходных. Подробнее узнай <a href="https://dushepolezno.ru/prostranstvo">тут</a>. Перед началом бронирования обязательно посмотри свободные слоты в <a href="https://dushepolezno.ru/prostranstvo-zapis">расписании</a>. Если все понятно вводи /book и мы начнем процесс бронирования. Подробнее  кабинетах введи /info',
    { parse_mode: 'HTML', disable_web_page_preview: false }
  );
});
bot.command('info', async ctx => {
  await ctx.react('👌');
  await ctx.reply(
    'В нашем пространстве есть два помещения разного размера: Кабинет 13 м2 и Зал 17 м2. Кабинет подходит для проведения консультаций, в том числе гупповых по 5-6 человек, для занятий с репетитором и для съемок фото или видео. Зал предназначен для лекций, выставок, творческих мастер-классов, коворкинга, использования пространства как мастерской или консультативнго пространства, зал вмещает в себя примерно 10-15 человек. Подробнее <a href="https://dushepolezno.ru/prostranstvo">тут</a>. Перед началом бронирования обязательно посмотри свободные слоты в <a href="https://dushepolezno.ru/prostranstvo-zapis">расписании</a>. Если все понятно вводи /book и мы начнем процесс бронирования',
    { parse_mode: 'HTML' }
  );
});
// Main conversation handler
bot.on('message', async ctx => {
  const { text } = ctx.message;
  const { step } = ctx.session;

  switch (step) {
    case 'askName':
      ctx.session.clientName = text;
      ctx.session.step = 'askContact';
      await ctx.reply(
        'Спасибо! Теперь, пожалуйста, введите ваш email в формате qwerty@yandex.com и телефон в формате +7(900)1234567.'
      );
      break;

    case 'askContact':
      ctx.session.contactInfo = text;
      ctx.session.step = 'askAppointment';
      await ctx.reply(
        'Отлично! Теперь введите название вашего мероприятия или цель бронирования.'
      );
      break;

    case 'askAppointment':
      ctx.session.appointmentName = text;
      ctx.session.step = 'chooseCabinet';

      const cabinetKeyboard = new InlineKeyboard()
        .text('Кабинет (13м²)', 'cabinet13')
        .text('Зал (17м²)', 'hall17');

      await ctx.reply('Выберите, пожалуйста, помещение:', {
        reply_markup: cabinetKeyboard,
      });
      break;

    case 'askDate':
      // Validate date format (DD/MM/YYYY)
      const dateRegex = /^\d{2}\/\d{2}\/\d{4}$/;

      if (!dateRegex.test(text)) {
        await ctx.reply(
          'Пожалуйста, введите дату в формате ДД/ММ/ГГГГ (например, 13/03/2025).'
        );
        break;
      }

      // Check if date is not in the past
      // Parse DD/MM/YYYY to a proper date object
      const [day, month, year] = text.split('/').map(Number);
      const selectedDate = new Date(year, month - 1, day); // Months are 0-indexed in JS
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (selectedDate < today) {
        await ctx.reply(
          'Пожалуйста, выберите дату не раньше сегодняшнего дня.'
        );
        break;
      }

      ctx.session.date = text;
      ctx.session.step = 'chooseStartTime';

      // Show time selection keyboard
      const timeKeyboard = generateTimeKeyboard();
      await ctx.reply('Выберите время начала (с 9:00 до 22:00):', {
        reply_markup: timeKeyboard,
      });
      break;

    case 'askCustomTime':
      // Validate time format (HH:MM-HH:MM)
      const timeRegex = /^\d{2}:\d{2}-\d{2}:\d{2}$/;

      if (!timeRegex.test(text)) {
        await ctx.reply(
          'Пожалуйста, введите время в формате ЧЧ:ММ-ЧЧ:ММ (например, 09:00-11:30).'
        );
        break;
      }

      ctx.session.customTime = text;
      ctx.session.timeSlot = 'custom';

      // Process the booking
      const [startTime, endTime] = text.split('-').map(t => t.trim());

      // Check availability
      const isAvailable = await isTimeSlotAvailable(
        ctx.session.date,
        startTime,
        endTime,
        ctx.session.cabinet
      );

      if (isAvailable) {
        try {
          await addEventToCalendar(ctx.session);
          await sendTelegramNotification(ctx.session);
          await ctx.reply(
            'Спасибо, мы свяжемся с вами в течение суток. Если вы не получили от нас ответа, пишите на @dushepolezno_work. Пока ждёте от нас ответа, ознакомьтесь, пожалуйста, с условиями <a href="https://yadi.sk/i/vYDfeS16TEy9aQ">бронирования</a>', { parse_mode: 'HTML' }
          );
          ctx.session.step = 'idle'; // Reset the conversation
        } catch (error) {
          console.error('Error processing booking:', error);
          await ctx.reply(
            'Произошла ошибка при бронировании. Пожалуйста, попробуйте еще раз или свяжитесь с менеджером.'
          );
        }
      } else {
        await ctx.reply(
          'Извините, это время уже забронировано. Пожалуйста, выберите другое время.'
        );
        ctx.session.step = 'chooseStartTime';
        const timeKeyboard = generateTimeKeyboard();
        await ctx.reply('Выберите время начала (с 9:00 до 22:00):', {
          reply_markup: timeKeyboard,
        });
      }
      break;

    default:
      await ctx.reply('Пожалуйста, нажмите /start для начала бронирования.');
  }
});

// Handle callbacks from inline keyboards
bot.on('callback_query', async ctx => {
  const callbackData = ctx.callbackQuery.data;

  switch (ctx.session.step) {
    case 'chooseCabinet':
      if (callbackData === 'cabinet13' || callbackData === 'hall17') {
        ctx.session.cabinet = callbackData;
        ctx.session.step = 'askDate';
        await ctx.answerCallbackQuery();
        await ctx.reply(
          'Пожалуйста, введите дату бронирования в формате ДД/ММ/ГГГГ (например, 13/03/2025).'
        );
      }
      break;

    case 'chooseStartTime':
      // Handle time selection (format: "HH:MM")
      const timeRegex = /^\d{2}:\d{2}$/;

      if (timeRegex.test(callbackData)) {
        ctx.session.startTime = callbackData;
        ctx.session.step = 'chooseTimeSlot';

        const timeSlotKeyboard = new InlineKeyboard()
          .text('1 час', '1hour')
          .text('1.5 часа', '1.5hours')
          .row()
          .text('2 часа', '2hours')
          // .text('Весь день', 'wholeDay')
          // .row()
          .text('Другое время', 'customTime');

        await ctx.answerCallbackQuery();
        await ctx.reply(
          `Выбрано время начала: ${callbackData}. Выберите продолжительность:`,
          { reply_markup: timeSlotKeyboard }
        );
      }
      break;

    case 'chooseTimeSlot':
      await ctx.answerCallbackQuery();

      if (callbackData === 'customTime') {
        ctx.session.step = 'askCustomTime';
        await ctx.reply(
          'Пожалуйста, введите начальное и конечное время в формате ЧЧ:ММ-ЧЧ:ММ (например, 09:00-11:30).'
        );
      } else {
        ctx.session.timeSlot = callbackData;

        // Process the booking
        let endTime;
        const timeRegex = /^\d{2}:\d{2}$/;
        if (timeRegex.test(callbackData) === 'wholeDay') {
          // For whole day, we don't need to check time conflicts
          try {
            await addEventToCalendar(ctx.session);
            await sendTelegramNotification(ctx.session);
            await ctx.reply(
              'Спасибо, мы свяжемся с вами в течение суток. Если вы не получили от нас ответа, пишите на @dushepolezno_work. Пока ждёте от нас ответа, ознакомьтесь, пожалуйста, с условиями <a href="https://yadi.sk/i/vYDfeS16TEy9aQ">бронирования</a>', { parse_mode: 'HTML' }
            );
            ctx.session.step = 'idle'; // Reset the conversation
          } catch (error) {
            console.error('Error processing booking:', error);
            await ctx.reply(
              'Произошла ошибка при бронировании. Пожалуйста, попробуйте еще раз или свяжитесь с менеджером.'
            );
          }
        } else {
          // For time slots, determine end time based on start time and duration
          const startTime = ctx.session.startTime;
          const [hours, minutes] = startTime.split(':').map(Number);

          // Convert DD/MM/YYYY to YYYY-MM-DD for date calculations
          const [day, month, year] = ctx.session.date.split('/').map(Number);
          const startDate = new Date(year, month - 1, day, hours, minutes);

          let durationHours = 0;

          if (callbackData === '1hour') {
            durationHours = 1;
          } else if (callbackData === '1.5hours') {
            durationHours = 1.5;
          } else if (callbackData === '2hours') {
            durationHours = 2;
          }
          // else if (callbackData === 'wholeDay') {
          //   durationHours = 24;
          // }

          const endDate = new Date(
            startDate.getTime() + durationHours * 60 * 60 * 1000
          );
          endTime = `${endDate.getHours().toString().padStart(2, '0')}:${endDate
            .getMinutes()
            .toString()
            .padStart(2, '0')}`;

          // Check availability
          const isAvailable = await isTimeSlotAvailable(
            ctx.session.date,
            startTime,
            endTime,
            ctx.session.cabinet
          );

          if (isAvailable) {
            try {
              await addEventToCalendar(ctx.session);
              await sendTelegramNotification(ctx.session);
              await ctx.reply(
                'Спасибо, мы свяжемся с вами в течение суток. Если вы не получили от нас ответа, пишите на @dushepolezno_work. Пока ждёте от нас ответа, ознакомьтесь, пожалуйста, с условиями <a href="https://yadi.sk/i/vYDfeS16TEy9aQ">бронирования</a>', { parse_mode: 'HTML' }
              );
              ctx.session.step = 'idle'; // Reset the conversation
            } catch (error) {
              console.error('Error processing booking:', error);
              await ctx.reply(
                'Произошла ошибка при бронировании. Пожалуйста, попробуйте еще раз или свяжитесь с менеджером.'
              );
            }
          } else {
            await ctx.reply(
              'Извините, это время уже забронировано. Пожалуйста, выберите другое время.'
            );
            ctx.session.step = 'chooseStartTime';
            const timeKeyboard = generateTimeKeyboard();
            await ctx.reply('Выберите время начала (с 9:00 до 22:00):', {
              reply_markup: timeKeyboard,
            });
          }
        }
      }
      break;
  }
});
// Errorssssssssssssss
bot.catch(err => {
  const ctx = err.ctx;
  console.error(`Error while handling update ${ctx.update.update_id}:`);
  const e = err.error;

  if (e instanceof GrammyError) {
    console.error('Error in request:', e.description);
  } else if (e instanceof HttpError) {
    console.error('Could not contact TG:', e);
  } else {
    console.error('Unknown error', e);
  }
});
// Add a health check route for deployment platforms
app.get('/', (req, res) => {
  res.send('Bot is running');
});

// Start the Express server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
bot.start();
