const PLACEHOLDER_IMAGE = "https://via.placeholder.com/600x300?text=Avto+Test";

// MVP demo: each ticket has 2 questions, but structure supports easy extension to 20+.
const tickets = [
  {
    id: "1",
    title: "1-bilet",
    questions: [
      {
        id: "1-1",
        image: "https://static.norma.uz/images/157114_b9bc154414caabb85768769fd2cc.jpg",
        text: "Svetofor qizil chirog'i yonib tursa nima qilish kerak?",
        options: ["Harakatni davom ettirish", "To'xtash", "Signal chalish", "Tezlashish"],
        correctIndex: 1,
        explanation: "Qizil chiroq — to'xtash belgisi."
      },
      {
        id: "1-2",
        image: "https://img.magnific.com/premium-vector/print-sign-stop_1030812-123.jpg?semt=ais_hybrid&w=740&q=80",
        text: "Yo'l belgisida 'STOP' bo'lsa, nima qilasiz?",
        options: ["To'xtab, yo'lni bo'shatib keyin yuraman", "Tormoz bosmay o'taman", "Faqat sekinlashaman", "Faqat kechasi to'xtayman"],
        correctIndex: 0,
        explanation: "STOP belgisi oldida to'liq to'xtash shart."
      }
    ]
  },
  {
    id: "2",
    title: "2-bilet",
    questions: [
      {
        id: "2-1",
        image: PLACEHOLDER_IMAGE,
        text: "Yo'l chizig'ini kesib o'tish qachon mumkin?",
        options: ["Hech qachon", "Qattiq chiziq bo'lsa ham", "Uzilgan (punktir) chiziqda", "Faqat o'ngga burilganda"],
        correctIndex: 2,
        explanation: "Punktir chiziqni sharoitga ko'ra kesib o'tish mumkin."
      },
      {
        id: "2-2",
        image: PLACEHOLDER_IMAGE,
        text: "Xavfsizlik kamarini qachon taqish kerak?",
        options: ["Faqat shahar tashqarisida", "Har doim", "Faqat haydovchi", "Kerak emas"],
        correctIndex: 1,
        explanation: "Kamar — har doim taqiladi."
      }
    ]
  },
  {
    id: "3",
    title: "3-bilet",
    questions: [
      {
        id: "3-1",
        image: PLACEHOLDER_IMAGE,
        text: "Piyoda o'tish joyida nima qilasiz?",
        options: ["Piyodaga yo'l beraman", "Signal chalib o'taman", "Tezlashaman", "To'xtamasdan o'taman"],
        correctIndex: 0,
        explanation: "Piyodaga yo'l berish majburiy."
      },
      {
        id: "3-2",
        image: PLACEHOLDER_IMAGE,
        text: "Telefon bilan gaplashib mashina haydash mumkinmi?",
        options: ["Ha, istalgan payt", "Yo'q, taqiqlanadi (hands-free bo'lmasa)", "Faqat tirbandlikda", "Faqat kechasi"],
        correctIndex: 1,
        explanation: "Haydashda chalg'ituvchi harakatlar xavfli va ko'p joylarda taqiqlangan."
      }
    ]
  },
  {
    id: "4",
    title: "4-bilet",
    questions: [
      {
        id: "4-1",
        image: PLACEHOLDER_IMAGE,
        text: "Burilish chirog'ini qachon yoqasiz?",
        options: ["Burilgandan keyin", "Burilishdan oldin", "Faqat kunduz", "Faqat trassada"],
        correctIndex: 1,
        explanation: "Burilish niyatini oldindan bildirish kerak."
      },
      {
        id: "4-2",
        image: PLACEHOLDER_IMAGE,
        text: "Tezlikni oshirib quvib o'tish xavfsizmi?",
        options: ["Har doim xavfsiz", "Sharoitga qarab, xavfsiz bo'lsa", "Faqat chapga burilganda", "Faqat yomg'irda"],
        correctIndex: 1,
        explanation: "Quvib o'tish faqat xavfsiz sharoitda amalga oshiriladi."
      }
    ]
  },
  {
    id: "5",
    title: "5-bilet",
    questions: [
      {
        id: "5-1",
        image: PLACEHOLDER_IMAGE,
        text: "Yo'l harakati qoidalariga amal qilish nima uchun muhim?",
        options: ["Jarima olmaslik uchun", "Xavfsizlik uchun", "Faqat imtihon uchun", "Muhim emas"],
        correctIndex: 1,
        explanation: "Asosiy maqsad — yo'l harakati xavfsizligi."
      },
      {
        id: "5-2",
        image: PLACEHOLDER_IMAGE,
        text: "Avtomobilni parkovkaga qo'yishda nima qilasiz?",
        options: ["Qoidalarga amal qilib, xavfsiz joyga qo'yaman", "Istalgan joyga", "Faqat yo'lakda", "Faqat piyoda yo'lagida"],
        correctIndex: 0,
        explanation: "To'g'ri parkovka xavfsizlik va tartib uchun muhim."
      }
    ]
  }
];

module.exports = { tickets };

