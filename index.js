require('dotenv').config();
const {
  Bot,
  GrammyError,
  session,
  HttpError,
  InlineKeyboard,
} = require('grammy');
const express = require('express');
const app = express();
const PORT = process.env.PORT || 8080;

// Initialize the bot
const bot = new Bot(process.env.BOT_API_KEY);

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
      endTime: '',
      customTime: '',
      needsAfisha: '',
    }),
  })
);

bot.api.setMyCommands([
  { command: 'start', description: 'Главное меню' },
  { command: 'book', description: 'Начать бронирование' },
]);

// Helper function to send Telegram notification to admin
async function sendTelegramNotification(sessionData) {
  const {
    clientName,
    contactInfo,
    appointmentName,
    cabinet,
    date,
    startTime,
    endTime,
    customTime,
    needsAfisha,
  } = sessionData;

  const timeInfo = customTime
    ? `Время: ${customTime}`
    : `С ${startTime} до ${endTime}`;

  const cabinetName = cabinet === 'cabinet13' ? 'Кабинет 13м²🔴' : 'Зал 17м²🔵';
  const afishaInfo = needsAfisha === 'yes' ? 'Да' : 'Нет';

  const message = `
🔔 *Новое бронирование ожидает подтверждения и оплаты*

👤 *Имя клиента:* ${clientName}
📞 *Контакт:* ${contactInfo}
📝 *Название:* ${appointmentName}
🏢 *Помещение:* ${cabinetName}
📅 *Дата:* ${date}
⏰ *Время:* ${timeInfo}
📢 *Нужна афиша:* ${afishaInfo}
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

  keyboard.row().text('Другое время', 'customTime');
  return keyboard;
}

// Start command - Main Menu
bot.command('start', async ctx => {
  const mainMenu = new InlineKeyboard()
    .text('✅ Забронировать', 'menu_book')
    .row()
    .text('ℹ️ О пространстве', 'menu_info')
    .row()
    .url('📅 Расписание', 'https://dushepolezno.ru/prostranstvo-zapis');

  ctx.session.step = 'idle';

  await ctx.reply(
    'Привет! 🤖 Я бот для аренды Пространства. Мы открыты с 9 до 22 и работаем без выходных. Подробнее <a href="https://dushepolezno.ru/prostranstvo">тут</a>. Перед началом бронирования обязательно посмотрите свободные слоты в <a href="https://dushepolezno.ru/prostranstvo-zapis">расписании</a>. Если все понятно введите /book и мы начнем процесс бронирования. Подробнее о кабинетах введите /info',
    { parse_mode: 'HTML', reply_markup: mainMenu }
  );
});

bot.command('book', async ctx => {
  ctx.session.step = 'askName';
  await ctx.reply(
    'Вы начали процесс бронирования кабинетов! Посмотреть актуальное расписание можно на нашем <a href="https://dushepolezno.ru/prostranstvo-zapis">сайте</a>. Сейчас я задам вам несколько вопросов о вашем мероприятии, чтобы передать эту информацию менеджеру. Для начала, введите ваше имя.',
    { parse_mode: 'HTML' }
  );
});

bot.command('info', async ctx => {
  await ctx.react('👌');
  await ctx.reply(
    'В нашем пространстве есть два помещения разного размера: Кабинет 13 м2 и Зал 17 м2. Кабинет подходит для проведения консультаций, в том числе групповых по 5-6 человек, для занятий с репетитором и для съемок фото или видео. Зал предназначен для лекций, выставок, творческих мастер-классов, коворкинга, использования пространства как мастерской или консультативного пространства, зал вмещает в себя примерно 10-15 человек. Подробнее <a href="https://dushepolezno.ru/prostranstvo">тут</a>. Перед началом бронирования обязательно посмотрите свободные слоты в <a href="https://dushepolezno.ru/prostranstvo-zapis">расписании</a>. Если все понятно введите /book и мы начнем процесс бронирования',
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
        'Спасибо! Как с вами можно будет связаться? Введите, пожалуйста, номер телефона, по которому вас можно найти в Telegram, в формате +7(900)1234567 или адрес электронной почты в формате qwerty@yandex.com'
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
        .text('Кабинет (13м²)🔴', 'cabinet13')
        .text('Зал (17м²)🔵', 'hall17');

      await ctx.reply('Выберите, пожалуйста, помещение:', {
        reply_markup: cabinetKeyboard,
      });
      break;

    case 'askDate':
      // Validate date format (DD/MM/YYYY)
      const dateRegex = /^\d{2}\/\d{2}\/\d{4}$/;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayDay = String(today.getDate()).padStart(2, '0');
      const todayMonth = String(today.getMonth() + 1).padStart(2, '0');
      const todayYear = today.getFullYear();
      const todayFormatted = `${todayDay}/${todayMonth}/${todayYear}`;

      if (!dateRegex.test(text)) {
        await ctx.reply(
          `Пожалуйста, введите дату в формате ДД/ММ/ГГГГ (например, ${todayFormatted}).`
        );
        break;
      }

      // Check if date is not in the past
      const [day, month, year] = text.split('/').map(Number);
      const selectedDate = new Date(year, month - 1, day);

      if (selectedDate < today) {
        await ctx.reply(
          'Пожалуйста, выберите дату не раньше сегодняшнего дня.'
        );
        break;
      }

      ctx.session.date = text;
      ctx.session.step = 'chooseStartTime';

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
      ctx.session.step = 'askNeedsAfisha';

      const afishaKeyboard = new InlineKeyboard()
        .text('Да', 'afisha_yes')
        .text('Нет', 'afisha_no');

      await ctx.reply('Нужна ли афиша для вашего мероприятия?', {
        reply_markup: afishaKeyboard,
      });
      break;

    default:
      await ctx.reply('Пожалуйста, нажмите /start для начала бронирования.');
  }
});

// Handle callbacks from inline keyboards
bot.on('callback_query', async ctx => {
  const callbackData = ctx.callbackQuery.data;

  switch (ctx.session.step) {
    case 'idle':
      if (callbackData === 'menu_book') {
        ctx.session.step = 'askName';
        await ctx.answerCallbackQuery();
        await ctx.reply(
          'Вы начали процесс бронирования кабинетов! Посмотреть актуальное расписание можно на нашем <a href="https://dushepolezno.ru/prostranstvo-zapis">сайте</a>. Сейчас я задам вам несколько вопросов о вашем мероприятии, чтобы передать эту информацию менеджеру. Для начала, введите ваше имя.',
          { parse_mode: 'HTML' }
        );
      }

      if (callbackData === 'menu_info') {
        await ctx.answerCallbackQuery();
        await ctx.reply(
          'В нашем пространстве есть два помещения разного размера: Кабинет 13 м2 и Зал 17 м2. Кабинет подходит для проведения консультаций, в том числе групповых по 5-6 человек, для занятий с репетитором и для съемок фото или видео. Зал предназначен для лекций, выставок, творческих мастер-классов, коворкинга, использования пространства как мастерской или консультативного пространства, зал вмещает в себя примерно 10-15 человек. Подробнее <a href="https://dushepolezno.ru/prostranstvo">тут</a>.',
          { parse_mode: 'HTML' }
        );
      }
      break;

    case 'chooseCabinet':
      if (callbackData === 'cabinet13' || callbackData === 'hall17') {
        ctx.session.cabinet = callbackData;
        ctx.session.step = 'askDate';
        await ctx.answerCallbackQuery();

        // Validate date format (DD/MM/YYYY)
        const dateRegex = /^\d{2}\/\d{2}\/\d{4}$/;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayDay = String(today.getDate()).padStart(2, '0');
        const todayMonth = String(today.getMonth() + 1).padStart(2, '0');
        const todayYear = today.getFullYear();
        const todayFormatted = `${todayDay}/${todayMonth}/${todayYear}`;

        await ctx.reply(
          `Пожалуйста, введите дату бронирования в формате ДД/ММ/ГГГГ (например, ${todayFormatted}).`
        );
      }
      break;

    case 'chooseStartTime':
      if (callbackData === 'customTime') {
        ctx.session.step = 'askCustomTime';
        await ctx.answerCallbackQuery();
        await ctx.reply(
          'Пожалуйста, введите начальное и конечное время в формате ЧЧ:ММ-ЧЧ:ММ (например, 09:00-11:30).'
        );
        break;
      }

      const timeRegex = /^\d{2}:\d{2}$/;
      if (timeRegex.test(callbackData)) {
        ctx.session.startTime = callbackData;
        ctx.session.step = 'chooseEndTime';

        await ctx.answerCallbackQuery();
        await ctx.reply(
          `Выбрано время начала: ${callbackData}. Выберите время окончания:`,
          { reply_markup: generateTimeKeyboard() }
        );
      }
      break;

    case 'chooseEndTime':
      if (callbackData === 'customTime') {
        ctx.session.step = 'askCustomTime';
        await ctx.answerCallbackQuery();
        await ctx.reply(
          'Пожалуйста, введите начальное и конечное время в формате ЧЧ:ММ-ЧЧ:ММ (например, 09:00-11:30).'
        );
        break;
      }

      ctx.session.endTime = callbackData;
      ctx.session.step = 'askNeedsAfisha';

      const afishaKeyboard = new InlineKeyboard()
        .text('Да', 'afisha_yes')
        .text('Нет', 'afisha_no');

      await ctx.answerCallbackQuery();
      await ctx.reply(
        'Хотите ли вы, чтобы мы добавили анонс вашего мероприятия на сайте и канале Пространства? Если да, то после подтверждения бронирования присылайте текст анонса с указанием контакта для регистрации и две-три фотографии на @dushepolezno_work.',
        { reply_markup: afishaKeyboard }
      );
      break;

    case 'askNeedsAfisha':
      ctx.session.needsAfisha = callbackData === 'afisha_yes' ? 'yes' : 'no';

      const timeInfo = ctx.session.customTime
        ? ctx.session.customTime
        : `с ${ctx.session.startTime} до ${ctx.session.endTime}`;

      const cabinetName =
        ctx.session.cabinet === 'cabinet13' ? 'Кабинет 13м²🔴' : 'Зал 17м²🔵';

      const preview = `
Проверьте данные:

👤 Имя: ${ctx.session.clientName}
📞 Контакт: ${ctx.session.contactInfo}
📝 Название: ${ctx.session.appointmentName}
🏢 Помещение: ${cabinetName}
📅 Дата: ${ctx.session.date}
⏰ Время: ${timeInfo}
📢 Афиша: ${ctx.session.needsAfisha === 'yes' ? 'Да' : 'Нет'}
      `;

      ctx.session.step = 'confirmBooking';

      await ctx.answerCallbackQuery();
      await ctx.reply(preview, {
        reply_markup: new InlineKeyboard()
          .text('✅ Подтвердить', 'confirm_yes')
          .text('❕ Редактировать', 'confirm_edit')
          .text('❌ Отменить', 'confirm_no'),
      });
      break;

    case 'confirmBooking':
      await ctx.answerCallbackQuery();

      if (callbackData === 'confirm_yes') {
        try {
          await sendTelegramNotification(ctx.session);
          await ctx.reply(
            'Спасибо, мы свяжемся с вами в течение суток. Если вы не получили от нас ответа, пишите на @dushepolezno_work. Пока ждёте от нас ответа, ознакомьтесь, пожалуйста, с правилами бронирования и использования помещения <a href="https://disk.yandex.ru/i/vYDfeS16TEy9aQ">бронирования</a>',
            { parse_mode: 'HTML' }
          );
          ctx.session.step = 'idle';
        } catch (error) {
          console.error('Error processing booking:', error);
          await ctx.reply(
            'Произошла ошибка при бронировании. Пожалуйста, попробуйте еще раз или свяжитесь с менеджером @dushepolezno_work.'
          );
        }
      }
      if (callbackData === 'confirm_edit') {
    
      if (callbackData === 'confirm_no') {
        ctx.session.step = 'idle';
        await ctx.reply('Бронирование отменено. Введите /start для начала.');
      }
      break;
  }
});

// Error handling
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
