// The inline "summarize and continue" card shown in the transcript when a
// conversation is nearly full. "Summarize and continue" already exists.
const title = 'Context nearly full';
const text =
  'This conversation has used {0}% of the model’s room. Summarize it and continue in a new one? The original stays in your history.';
const decline = 'Not now';

export const compactionOfferTranslations = {
  ar: {
    [title]: 'السياق شبه ممتلئ',
    [text]:
      'استخدمت هذه المحادثة {0}% من سعة النموذج. هل تريد تلخيصها والمتابعة في محادثة جديدة؟ تبقى المحادثة الأصلية في سجلك.',
    [decline]: 'ليس الآن',
  },
  de: {
    [title]: 'Kontext fast voll',
    [text]:
      'Diese Unterhaltung hat {0} % des Platzes des Modells belegt. Zusammenfassen und in einer neuen fortsetzen? Das Original bleibt in Ihrem Verlauf.',
    [decline]: 'Nicht jetzt',
  },
  es: {
    [title]: 'Contexto casi lleno',
    [text]:
      'Esta conversación ha usado el {0} % del espacio del modelo. ¿Resumirla y continuar en una nueva? La original se conserva en tu historial.',
    [decline]: 'Ahora no',
  },
  fa: {
    [title]: 'زمینه تقریباً پر است',
    [text]:
      'این گفتگو {0}٪ از ظرفیت مدل را استفاده کرده است. خلاصه شود و در گفتگوی جدید ادامه پیدا کند؟ گفتگوی اصلی در تاریخچهٔ شما می‌ماند.',
    [decline]: 'حالا نه',
  },
  fr: {
    [title]: 'Contexte presque plein',
    [text]:
      'Cette conversation a utilisé {0} % de la place du modèle. La résumer et continuer dans une nouvelle ? L’originale reste dans votre historique.',
    [decline]: 'Pas maintenant',
  },
  hi: {
    [title]: 'संदर्भ लगभग भर गया है',
    [text]:
      'इस बातचीत ने मॉडल की जगह का {0}% उपयोग कर लिया है। इसका सारांश बनाकर नई बातचीत में जारी रखें? मूल बातचीत आपके इतिहास में बनी रहती है।',
    [decline]: 'अभी नहीं',
  },
  it: {
    [title]: 'Contesto quasi pieno',
    [text]:
      'Questa conversazione ha usato il {0}% dello spazio del modello. Riassumerla e continuare in una nuova? L’originale resta nella cronologia.',
    [decline]: 'Non ora',
  },
  ja: {
    [title]: 'コンテキストがほぼ満杯です',
    [text]:
      'この会話はモデルの容量の {0}% を使用しました。要約して新しい会話で続けますか？元の会話は履歴に残ります。',
    [decline]: '今はしない',
  },
  pt: {
    [title]: 'Contexto quase cheio',
    [text]:
      'Esta conversa usou {0}% do espaço do modelo. Resumir e continuar numa nova? A original continua no seu histórico.',
    [decline]: 'Agora não',
  },
  ru: {
    [title]: 'Контекст почти заполнен',
    [text]:
      'Этот разговор занял {0}% места в окне модели. Подвести итог и продолжить в новом? Исходный разговор останется в истории.',
    [decline]: 'Не сейчас',
  },
  th: {
    [title]: 'บริบทใกล้เต็มแล้ว',
    [text]:
      'การสนทนานี้ใช้พื้นที่ของโมเดลไปแล้ว {0}% สรุปและดำเนินการต่อในการสนทนาใหม่หรือไม่ การสนทนาเดิมจะยังอยู่ในประวัติของคุณ',
    [decline]: 'ไว้ก่อน',
  },
  zh: {
    [title]: '上下文即将用满',
    [text]: '此对话已使用模型 {0}% 的空间。要总结并在新对话中继续吗？原对话会保留在历史记录中。',
    [decline]: '暂不',
  },
};
