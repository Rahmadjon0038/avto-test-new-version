export type LanguageCode = "uz_latn" | "uz_cyrl" | "ru";

export const SUPPORTED_LANGUAGES: LanguageCode[] = ["uz_latn", "uz_cyrl", "ru"];
export const DEFAULT_LANGUAGE: LanguageCode = "uz_latn";
export const LANGUAGE_COOKIE = "topshirdi_language_v1";
export const LANGUAGE_STORAGE_KEY = "topshirdi_language_v1";

export const LANGUAGE_OPTIONS: Array<{ code: LanguageCode; label: string; shortLabel: string }> = [
  { code: "uz_latn", label: "O'zbek lotin", shortLabel: "UZ" },
  { code: "uz_cyrl", label: "Ўзбек кирилл", shortLabel: "ЎЗ" },
  { code: "ru", label: "Русский", shortLabel: "RU" }
];

type TranslationTree = Record<string, any>;

const translations: Record<LanguageCode, TranslationTree> = {
  uz_latn: {
    common: {
      back: "Orqaga",
      next: "Keyingi",
      close: "Yopish",
      save: "Saqlash",
      loading: "Yuklanmoqda...",
      selectLanguage: "Tilni tanlang",
      language: "Til",
      search: "Qidirish",
      retry: "Qayta urinish",
      noData: "Mavjud emas",
      internetRequired: "Internet aloqasi yo‘q",
      error: "Xatolik"
    },
    nav: {
      login: "Tizimga kirish",
      profile: "Profil",
      adminPanel: "Admin panel",
      subscription: "Obuna",
      buySubscription: "Obunani sotib olish"
    },
    footer: {
      privacy: "Maxfiylik siyosati",
      tickets: "Biletlar",
      topics: "Mavzular"
    },
    auth: {
      brand: "Topshirdi",
      heroTitle: "Haydovchilikka tayyormisiz?",
      heroText: "Nazariy bilimlaringizni sinang va imtihonga tayyorlaning.",
      enterTests: "Testlarga kirish",
      registerTitle: "Ro‘yxatdan o‘tish",
      loginTitle: "Tizimga kirish",
      phone: "Telefon raqam",
      password: "Parol",
      confirmPassword: "Parolni tasdiqlash",
      forgotPassword: "Parolni unutdingizmi?",
      googleLogin: "Google orqali kirish",
      registerSuccess: "Ro‘yxatdan o‘tildi. Endi tizimga kiring.",
      loginSuccess: "Tizimga kirildi",
      googleTokenMissing: "Google token topilmadi",
      googleLoginFailed: "Google orqali kirish amalga oshmadi",
      googleLoginSuccess: "Google orqali kirildi",
      loginFailed: "Kirish amalga oshmadi",
      registerFailed: "Ro‘yxatdan o‘tish amalga oshmadi",
      loginButton: "Kirish",
      registerButton: "Ro‘yxatdan o‘tish"
    },
    home: {
      hero: "Prava olish endi biz bilan oson!",
      topicsTitle: "Mavzu bo‘yicha testlar",
      topicsDesc: "Belgilar va qoidalarni bo‘limma-bo‘lim o‘rganing.",
      ticketsTitle: "Biletlar bo‘yicha testlar",
      ticketsDesc: "Rasmiy biletlar formatida yechib mashq qiling.",
      videosTitle: "Video darsliklar",
      videosDesc: "Mavzulashtirilgan video darsliklar.",
      marathonTitle: "Marafon rejimi",
      marathonDesc: "Uzluksiz savollar: tezlik va aniqlikni oshiring.",
      customTitle: "Sozlamali testlar",
      customDesc: "Savol soni va rejimni o‘zingiz tanlang.",
      mistakesTitle: "Mening xatolarim",
      mistakesDesc: "Xato qilgan savollaringizni qayta ko‘rib chiqing.",
      answersTitle: "Barcha testlar javoblari",
      answersDesc: "To‘g‘ri javoblarni izohlar bilan ko‘ring.",
      examTitle: "Imtihon topshirish",
      examDesc: "Haqiqiy imtihondek sinovdan o‘ting.",
      startTests: "Testlarga kirish",
      menuSoon: "Tez kunda",
      menuSoonTitle: "Hozircha demo sahifa",
      demoLabel: "Demo",
      comingSoonText: "Bu bo‘lim keyinroq to‘ldiriladi."
    },
    topics: {
      title: "Mavzularni tanlang",
      subtitle: "Kartaga bosganda shu mavzuning alohida sahifasi ochiladi.",
      loading: "Mavzular yuklanmoqda...",
      empty: "Mavzular hozircha mavjud emas.",
      back: "Orqaga"
    },
    topicDetail: {
      lockedTitle: "Bu mavzu yopiq",
      lockedText: "Bu mavzu faqat ro‘yxatdan o‘tgan foydalanuvchilar uchun. Birinchi mavzu bepul ochiq.",
      progressReset: "Qayta boshlash",
      finish: "Yakunlash",
      finishTitle: "Natija",
      rightAnswer: "To‘g‘ri javob",
      explanation: "Izoh",
      noQuestions: "Bu mavzuda savollar topilmadi."
    },
    tickets: {
      title: "Biletlar bo‘yicha testlar",
      lockedTitle: "Bu bilet yopiq",
      lockedText: "Bu bilet faqat ro‘yxatdan o‘tgan foydalanuvchilar uchun. Birinchi biletlar bepul ochiq.",
      empty: "Biletlar hozircha mavjud emas."
    },
    custom: {
      title: "Sozlamali testlar",
      subtitle: "Kartalar biletlar bankidagi savollardan yig‘iladi.",
      loading: "Testlar yuklanmoqda...",
      empty: "Testlar topilmadi"
    },
    mistakes: {
      title: "Mening xatolarim",
      subtitle: "Xato bo‘lgan savollarni alohida ko‘ring va mashq qiling.",
      loading: "Xatolar yuklanmoqda...",
      empty: "Hozircha xatolar yo‘q",
      listTab: "Ro‘yxat",
      practiceTab: "Mashq qilish",
      clear: "Tozalash"
    },
    answers: {
      title: "Barcha testlar javoblari",
      subtitle: "Javoblar faqat biletlar bankidagi savollardan ko‘rsatiladi.",
      search: "Qidirish",
      placeholder: "Savol, izoh yoki javob bo‘yicha qidiring",
      all: "Barchasi",
      withImage: "Rasmli",
      withoutImage: "Rasmsiz",
      total: "{count} ta savol",
      loaded: "{count} yuklandi",
      continue: "Davom etadi",
      allDone: "Hammasi",
      empty: "Natija topilmadi"
    },
    marathon: {
      title: "Marafon rejimi",
      loading: "Marafon yuklanmoqda...",
      empty: "Hozircha savollar topilmadi.",
      back: "Orqaga",
      restart: "Qayta boshlash",
      finish: "Yakunlash",
      answerCount: "Javoblar: {answered}/{total}",
      resultTitle: "Natija",
      correctLabel: "To‘g‘ri"
    },
    exam: {
      title: "Imtihon topshirish",
      loading: "Imtihon ma'lumotlari yuklanmoqda...",
      empty: "Imtihon ma'lumotlari topilmadi",
      finished: "Imtihon yakunlangan. Qayta boshlash uchun \"Qayta boshlash\" tugmasini bosing.",
      restart: "Qayta boshlash",
      finish: "Yakunlash",
      resultTitle: "Natija",
      correctLabel: "To‘g‘ri"
    },
    videos: {
      title: "Video darsliklar",
      loading: "Video darslar yuklanmoqda...",
      empty: "Hozircha videodarslar mavjud emas",
      retry: "Qayta urinish"
    },
    settings: {
      title: "Test sozlamalari",
      subtitle: "Test yechish ko‘rinishini o‘zingizga moslang.",
      shuffleTitle: "Testlarni aralashtirish",
      shuffleDesc: "Savollar tartibi har safar aralash ko‘rinadi.",
      autoNextTitle: "Avtomatik o‘tish",
      autoNextDesc: "Javob tanlanganda keyingi savolga o‘tadi."
    },
    progress: {
      correct: "{count} ta to‘g‘ri",
      wrong: "{count} ta noto‘g‘ri",
      unanswered: "{count} ta belgilanmagan",
      title: "Progres",
      empty: "Natija hali yo‘q"
    },
    publicRunner: {
      unanswered: "Javoblar: {answered}/{total}",
      restart: "Qayta boshlash",
      finish: "Yakunlash",
      resultTitle: "Natija",
      correctLabel: "To‘g‘ri",
      correctAnswers: "To‘g‘ri javoblar",
      emptySlot: "Bu slot hali to‘ldirilmagan",
      emptyQuestion: "Bu savol hali to‘ldirilmagan.",
      finishButton: "Yopish"
    },
    public: {
      registerCtaTitle: "Hammasi bir joyda — bepul boshlang",
      registerCtaText: "Barcha biletlar, mavzular va imtihon rejimi bilan to‘liq mashq qilish uchun ro‘yxatdan o‘ting.",
      registerCtaButton: "Ro‘yxatdan o‘tish",
      correctAnswer: "To‘g‘ri javob",
      explanation: "Izoh"
    }
  },
  uz_cyrl: {
    common: {
      back: "Орқага",
      next: "Кейинги",
      close: "Ёпиш",
      save: "Сақлаш",
      loading: "Юкланмоқда...",
      selectLanguage: "Тилни танланг",
      language: "Тил",
      search: "Қидириш",
      retry: "Қайта уриниш",
      noData: "Мавжуд эмас",
      internetRequired: "Интернет алоқаси йўқ",
      error: "Хатолик"
    },
    nav: {
      login: "Тизимга кириш",
      profile: "Профиль",
      adminPanel: "Админ панель",
      subscription: "Обуна",
      buySubscription: "Обунани сотиб олиш"
    },
    footer: {
      privacy: "Махфийлик сиёсати",
      tickets: "Билетлар",
      topics: "Мавзулар"
    },
    auth: {
      brand: "Topshirdi",
      heroTitle: "Ҳайдовчиликка тайёрмисиз?",
      heroText: "Назарий билимларингизни синаб кўринг ва имтиҳонга тайёрланинг.",
      enterTests: "Тестларга кириш",
      registerTitle: "Рўйхатдан ўтиш",
      loginTitle: "Тизимга кириш",
      phone: "Телефон рақам",
      password: "Парол",
      confirmPassword: "Паролни тасдиқлаш",
      forgotPassword: "Паролни унутдингизми?",
      googleLogin: "Google орқали кириш",
      registerSuccess: "Рўйхатдан ўтилди. Энди тизимга киринг.",
      loginSuccess: "Тизимга кирилди",
      googleTokenMissing: "Google токен топилмади",
      googleLoginFailed: "Google орқали кириш амалга ошмади",
      googleLoginSuccess: "Google орқали кирилди",
      loginFailed: "Кириш амалга ошмади",
      registerFailed: "Рўйхатдан ўтиш амалга ошмади",
      loginButton: "Кириш",
      registerButton: "Рўйхатдан ўтиш"
    },
    home: {
      hero: "Права олиш энди биз билан осон!",
      topicsTitle: "Мавзу бўйича тестлар",
      topicsDesc: "Белгилар ва қоидаларни бўлимма-бўлим ўрганинг.",
      ticketsTitle: "Билетлар бўйича тестлар",
      ticketsDesc: "Расмий билетлар форматида ечиб машқ қилинг.",
      videosTitle: "Видео дарсликлар",
      videosDesc: "Мавзуллаштирилган видео дарсликлар.",
      marathonTitle: "Марафон режими",
      marathonDesc: "Узлуксиз саволлар: тезлик ва аниқликни оширинг.",
      customTitle: "Созламали тестлар",
      customDesc: "Савол сони ва режимни ўзингиз танланг.",
      mistakesTitle: "Менинг хатоларим",
      mistakesDesc: "Хато қилган саволларингизни қайта кўриб чиқинг.",
      answersTitle: "Барча тестлар жавоблари",
      answersDesc: "Тўғри жавобларни изоҳлар билан кўринг.",
      examTitle: "Имтиҳон топшириш",
      examDesc: "Ҳақиқий имтиҳондек синовдан ўтинг.",
      startTests: "Тестларга кириш",
      menuSoon: "Тез кунда",
      menuSoonTitle: "Ҳозирча демо саҳифа",
      demoLabel: "Демо",
      comingSoonText: "Бу бўлим кейинроқ тўлдирилади."
    },
    topics: {
      title: "Мавзуларни танланг",
      subtitle: "Картага босганда шу мавзунинг алоҳида саҳифаси очилади.",
      loading: "Мавзулар юкланмоқда...",
      empty: "Мавзулар ҳозирча мавжуд эмас.",
      back: "Орқага"
    },
    topicDetail: {
      lockedTitle: "Бу мавзу ёпиқ",
      lockedText: "Бу мавзу фақат рўйхатдан ўтган фойдаланувчилар учун. Биринчи мавзу бепул очиқ.",
      progressReset: "Қайта бошлаш",
      finish: "Якунлаш",
      finishTitle: "Натижа",
      rightAnswer: "Тўғри жавоб",
      explanation: "Изоҳ",
      noQuestions: "Бу мавзуда саволлар топилмади."
    },
    tickets: {
      title: "Билетлар бўйича тестлар",
      lockedTitle: "Бу билет ёпиқ",
      lockedText: "Бу билет фақат рўйхатдан ўтган фойдаланувчилар учун. Биринчи билетлар бепул очиқ.",
      empty: "Билетлар ҳозирча мавжуд эмас."
    },
    custom: {
      title: "Созламали тестлар",
      subtitle: "Карталар билетлар банкидаги саволлардан йиғилади.",
      loading: "Тестлар юкланмоқда...",
      empty: "Тестлар топилмади"
    },
    mistakes: {
      title: "Менинг хатоларим",
      subtitle: "Хато бўлган саволларни алоҳида кўринг ва машқ қилинг.",
      loading: "Хатолар юкланмоқда...",
      empty: "Ҳозирча хатолар йўқ",
      listTab: "Рўйхат",
      practiceTab: "Машқ қилиш",
      clear: "Тозалаш"
    },
    answers: {
      title: "Барча тестлар жавоблари",
      subtitle: "Жавоблар фақат билетлар банкидаги саволлардан кўрсатилади.",
      search: "Қидириш",
      placeholder: "Савол, изоҳ ёки жавоб бўйича қидиринг",
      all: "Барчаси",
      withImage: "Расмли",
      withoutImage: "Расмсиз",
      total: "{count} та савол",
      loaded: "{count} юкланди",
      continue: "Давом этади",
      allDone: "Ҳаммаси",
      empty: "Натижа топилмади"
    },
    marathon: {
      title: "Марафон режими",
      loading: "Марафон юкланмоқда...",
      empty: "Ҳозирча саволлар топилмади.",
      back: "Орқага",
      restart: "Қайта бошлаш",
      finish: "Якунлаш",
      answerCount: "Жавоблар: {answered}/{total}",
      resultTitle: "Натижа",
      correctLabel: "Тўғри"
    },
    exam: {
      title: "Имтиҳон топшириш",
      loading: "Имтиҳон маълумотлари юкланмоқда...",
      empty: "Имтиҳон маълумотлари топилмади",
      finished: "Имтиҳон якунланган. Қайта бошлаш учун \"Қайта бошлаш\" тугмасини босинг.",
      restart: "Қайта бошлаш",
      finish: "Якунлаш",
      resultTitle: "Натижа",
      correctLabel: "Тўғри"
    },
    videos: {
      title: "Видео дарсликлар",
      loading: "Видео дарслар юкланмоқда...",
      empty: "Ҳозирча видеодарсликлар мавжуд эмас",
      retry: "Қайта уриниш"
    },
    settings: {
      title: "Тест созламалари",
      subtitle: "Тест ечиш кўринишини ўзингизга мосланг.",
      shuffleTitle: "Тестларни аралаштириш",
      shuffleDesc: "Саволлар тартиби ҳар сафар аралаш кўринади.",
      autoNextTitle: "Автоматик ўтиш",
      autoNextDesc: "Жавоб танланганда кейинги саволга ўтади."
    },
    progress: {
      correct: "{count} та тўғри",
      wrong: "{count} та нотўғри",
      unanswered: "{count} та белгиланмаган",
      title: "Прогресс",
      empty: "Натижа ҳали йўқ"
    },
    publicRunner: {
      unanswered: "Жавоблар: {answered}/{total}",
      restart: "Қайта бошлаш",
      finish: "Якунлаш",
      resultTitle: "Натижа",
      correctLabel: "Тўғри",
      correctAnswers: "Тўғри жавоблар",
      emptySlot: "Бу слот ҳали тўлдирилмаган",
      emptyQuestion: "Бу савол ҳали тўлдирилмаган.",
      finishButton: "Ёпиш"
    },
    public: {
      registerCtaTitle: "Ҳаммаси бир жойда — бепул бошланг",
      registerCtaText: "Барча билетлар, мавзулар ва имтиҳон режими билан тўлиқ машқ қилиш учун рўйхатдан ўтинг.",
      registerCtaButton: "Рўйхатдан ўтиш",
      correctAnswer: "Тўғри жавоб",
      explanation: "Изоҳ"
    }
  },
  ru: {
    common: {
      back: "Назад",
      next: "Далее",
      close: "Закрыть",
      save: "Сохранить",
      loading: "Загрузка...",
      selectLanguage: "Выберите язык",
      language: "Язык",
      search: "Поиск",
      retry: "Повторить",
      noData: "Нет данных",
      internetRequired: "Нет интернета",
      error: "Ошибка"
    },
    nav: {
      login: "Войти",
      profile: "Профиль",
      adminPanel: "Админ панель",
      subscription: "Подписка",
      buySubscription: "Купить подписку"
    },
    footer: {
      privacy: "Политика конфиденциальности",
      tickets: "Билеты",
      topics: "Темы"
    },
    auth: {
      brand: "Topshirdi",
      heroTitle: "Готовы ли вы к вождению?",
      heroText: "Проверьте теоретические знания и подготовьтесь к экзамену.",
      enterTests: "Войти в тесты",
      registerTitle: "Регистрация",
      loginTitle: "Войти",
      phone: "Номер телефона",
      password: "Пароль",
      confirmPassword: "Подтвердите пароль",
      forgotPassword: "Забыли пароль?",
      googleLogin: "Войти через Google",
      registerSuccess: "Вы зарегистрированы. Теперь войдите в систему.",
      loginSuccess: "Вход выполнен",
      googleTokenMissing: "Google токен не найден",
      googleLoginFailed: "Не удалось войти через Google",
      googleLoginSuccess: "Вход через Google выполнен",
      loginFailed: "Не удалось войти",
      registerFailed: "Не удалось зарегистрироваться",
      loginButton: "Войти",
      registerButton: "Регистрация"
    },
    home: {
      hero: "Получить права теперь легко вместе с нами!",
      topicsTitle: "Тесты по темам",
      topicsDesc: "Изучайте знаки и правила по разделам.",
      ticketsTitle: "Тесты по билетам",
      ticketsDesc: "Практикуйтесь в формате официальных билетов.",
      videosTitle: "Видео уроки",
      videosDesc: "Тематические видеоуроки.",
      marathonTitle: "Режим марафона",
      marathonDesc: "Непрерывные вопросы: повышайте скорость и точность.",
      customTitle: "Настраиваемые тесты",
      customDesc: "Выберите количество вопросов и режим.",
      mistakesTitle: "Мои ошибки",
      mistakesDesc: "Посмотрите вопросы, в которых были ошибки.",
      answersTitle: "Ответы ко всем тестам",
      answersDesc: "Смотрите правильные ответы с пояснениями.",
      examTitle: "Сдать экзамен",
      examDesc: "Пройдите проверку как на настоящем экзамене.",
      startTests: "Войти в тесты",
      menuSoon: "Скоро",
      menuSoonTitle: "Пока демо-страница",
      demoLabel: "Демо",
      comingSoonText: "Этот раздел будет заполнен позже."
    },
    topics: {
      title: "Выберите тему",
      subtitle: "Нажмите на карточку, чтобы открыть отдельную страницу темы.",
      loading: "Загрузка тем...",
      empty: "Пока нет доступных тем.",
      back: "Назад"
    },
    topicDetail: {
      lockedTitle: "Эта тема закрыта",
      lockedText: "Эта тема доступна только зарегистрированным пользователям. Первая тема открыта бесплатно.",
      progressReset: "Начать заново",
      finish: "Завершить",
      finishTitle: "Результат",
      rightAnswer: "Правильный ответ",
      explanation: "Пояснение",
      noQuestions: "В этой теме не найдено вопросов."
    },
    tickets: {
      title: "Тесты по билетам",
      lockedTitle: "Этот билет закрыт",
      lockedText: "Этот билет доступен только зарегистрированным пользователям. Первые билеты открыты бесплатно.",
      empty: "Пока нет билетов."
    },
    custom: {
      title: "Настраиваемые тесты",
      subtitle: "Карточки собираются из банка вопросов билетов.",
      loading: "Загрузка тестов...",
      empty: "Тесты не найдены"
    },
    mistakes: {
      title: "Мои ошибки",
      subtitle: "Смотрите вопросы с ошибками отдельно и тренируйтесь.",
      loading: "Загрузка ошибок...",
      empty: "Пока ошибок нет",
      listTab: "Список",
      practiceTab: "Практика",
      clear: "Очистить"
    },
    answers: {
      title: "Ответы ко всем тестам",
      subtitle: "Ответы показываются только из банка билетов.",
      search: "Поиск",
      placeholder: "Ищите по вопросу, пояснению или ответу",
      all: "Все",
      withImage: "С изображением",
      withoutImage: "Без изображения",
      total: "{count} вопросов",
      loaded: "{count} загружено",
      continue: "Продолжается",
      allDone: "Все",
      empty: "Ничего не найдено"
    },
    marathon: {
      title: "Режим марафона",
      loading: "Загрузка марафона...",
      empty: "Пока вопросы не найдены.",
      back: "Назад",
      restart: "Начать заново",
      finish: "Завершить",
      answerCount: "Ответы: {answered}/{total}",
      resultTitle: "Результат",
      correctLabel: "Верно"
    },
    exam: {
      title: "Сдать экзамен",
      loading: "Загрузка данных экзамена...",
      empty: "Данные экзамена не найдены",
      finished: "Экзамен завершён. Чтобы начать заново, нажмите кнопку \"Начать заново\".",
      restart: "Начать заново",
      finish: "Завершить",
      resultTitle: "Результат",
      correctLabel: "Верно"
    },
    videos: {
      title: "Видео уроки",
      loading: "Загрузка видеоуроков...",
      empty: "Пока нет видеоуроков",
      retry: "Повторить"
    },
    settings: {
      title: "Настройки теста",
      subtitle: "Настройте вид теста под себя.",
      shuffleTitle: "Перемешивать вопросы",
      shuffleDesc: "Порядок вопросов каждый раз будет другим.",
      autoNextTitle: "Автопереход",
      autoNextDesc: "После ответа переходить к следующему вопросу."
    },
    progress: {
      correct: "{count} верных",
      wrong: "{count} неверных",
      unanswered: "{count} без ответа",
      title: "Прогресс",
      empty: "Пока нет результата"
    },
    publicRunner: {
      unanswered: "Ответы: {answered}/{total}",
      restart: "Начать заново",
      finish: "Завершить",
      resultTitle: "Результат",
      correctLabel: "Верно",
      correctAnswers: "Верные ответы",
      emptySlot: "Этот слот ещё не заполнен",
      emptyQuestion: "Этот вопрос ещё не заполнен.",
      finishButton: "Закрыть"
    },
    public: {
      registerCtaTitle: "Всё в одном месте — начните бесплатно",
      registerCtaText: "Зарегистрируйтесь, чтобы полноценно тренироваться по билетам, темам и экзамену.",
      registerCtaButton: "Регистрация",
      correctAnswer: "Правильный ответ",
      explanation: "Пояснение"
    }
  }
};

export function normalizeLanguageCode(value: string | null | undefined, fallback: LanguageCode = DEFAULT_LANGUAGE): LanguageCode {
  const raw = String(value || "").trim().toLowerCase().replace(/-/g, "_");
  if (!raw) return fallback;
  if (SUPPORTED_LANGUAGES.includes(raw as LanguageCode)) return raw as LanguageCode;
  return fallback;
}

export function getTranslation(language: string | null | undefined, key: string, vars?: Record<string, string | number>): string {
  const lang = normalizeLanguageCode(language, DEFAULT_LANGUAGE);
  const value = key.split(".").reduce<any>((acc, part) => (acc && typeof acc === "object" ? acc[part] : undefined), translations[lang]);
  const fallbackValue = key.split(".").reduce<any>((acc, part) => (acc && typeof acc === "object" ? acc[part] : undefined), translations[DEFAULT_LANGUAGE]);
  const text = String(value ?? fallbackValue ?? key);
  if (!vars) return text;
  return Object.entries(vars).reduce((acc, [name, replacement]) => acc.replaceAll(`{${name}}`, String(replacement)), text);
}

export function appendLanguageQuery(path: string, language?: string | null) {
  const lang = normalizeLanguageCode(language, DEFAULT_LANGUAGE);
  const [base, query = ""] = String(path || "").split("?");
  const params = new URLSearchParams(query);
  params.set("lang", lang);
  const suffix = params.toString();
  return suffix ? `${base}?${suffix}` : base;
}

export function getBrowserLanguage(): LanguageCode {
  if (typeof window === "undefined") return DEFAULT_LANGUAGE;
  const cookie = document.cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${LANGUAGE_COOKIE}=`))
    ?.split("=")
    .slice(1)
    .join("=");
  const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  return normalizeLanguageCode(cookie || stored || document.documentElement.lang || DEFAULT_LANGUAGE, DEFAULT_LANGUAGE);
}

export function setBrowserLanguage(language: string) {
  const next = normalizeLanguageCode(language, DEFAULT_LANGUAGE);
  if (typeof window === "undefined") return next;
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
  document.cookie = `${LANGUAGE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  document.documentElement.lang = next.replace("_", "-");
  return next;
}

export function getLanguageOption(language: string | null | undefined) {
  return LANGUAGE_OPTIONS.find((option) => option.code === normalizeLanguageCode(language, DEFAULT_LANGUAGE)) || LANGUAGE_OPTIONS[0];
}
