// Model fallback: the clawAI.fallbackModels setting and the panel notice shown
// when a rate-limited model is replaced. Same shape as the other tables.
const setting =
  'Models to switch to, in order, when the selected model stays rate limited (HTTP 429). Use provider/model or a bare model. Each is tried once; leave empty to end the run with a clear message instead.';
const label = 'Switched model';
const detail = '{0} is rate limited; continuing on {1}';

export const modelFallbackTranslations = {
  ar: {
    [setting]:
      'النماذج التي يُنتقل إليها بالترتيب عندما يظل النموذج المحدد مقيّدًا بحد المعدل (HTTP 429). استخدم مزوّد/نموذج أو اسم نموذج فقط. تُجرَّب كل منها مرة واحدة؛ اتركها فارغة لإنهاء التشغيل برسالة واضحة بدلًا من ذلك.',
    [label]: 'تم تبديل النموذج',
    [detail]: '{0} مقيّد بحد المعدل؛ المتابعة على {1}',
  },
  de: {
    [setting]:
      'Modelle, auf die der Reihe nach gewechselt wird, wenn das gewählte Modell weiter ratenbegrenzt ist (HTTP 429). Anbieter/Modell oder nur ein Modellname. Jedes wird einmal versucht; leer lassen, damit der Lauf stattdessen mit einer klaren Meldung endet.',
    [label]: 'Modell gewechselt',
    [detail]: '{0} ist ratenbegrenzt; es geht mit {1} weiter',
  },
  es: {
    [setting]:
      'Modelos a los que cambiar, en orden, cuando el modelo elegido sigue limitado por tasa (HTTP 429). Usa proveedor/modelo o solo un modelo. Cada uno se prueba una vez; déjalo vacío para que la ejecución termine con un mensaje claro.',
    [label]: 'Modelo cambiado',
    [detail]: '{0} está limitado por tasa; se continúa con {1}',
  },
  fa: {
    [setting]:
      'مدل‌هایی که به‌ترتیب جایگزین می‌شوند وقتی مدل انتخاب‌شده همچنان محدودیت نرخ دارد (HTTP 429). از ارائه‌دهنده/مدل یا فقط نام مدل استفاده کنید. هر کدام یک بار امتحان می‌شود؛ خالی بگذارید تا اجرا با پیامی روشن پایان یابد.',
    [label]: 'مدل عوض شد',
    [detail]: '{0} محدودیت نرخ دارد؛ ادامه با {1}',
  },
  fr: {
    [setting]:
      'Modèles vers lesquels basculer, dans l’ordre, quand le modèle choisi reste limité en débit (HTTP 429). Utilisez fournisseur/modèle ou un simple modèle. Chacun est essayé une fois ; laissez vide pour que l’exécution se termine par un message clair.',
    [label]: 'Modèle changé',
    [detail]: '{0} est limité en débit ; poursuite avec {1}',
  },
  hi: {
    [setting]:
      'चुना गया मॉडल लगातार रेट-सीमित (HTTP 429) रहने पर क्रम से इन मॉडलों पर स्विच किया जाता है। प्रदाता/मॉडल या सिर्फ़ मॉडल का नाम दें। हर एक को एक बार आज़माया जाता है; खाली छोड़ने पर रन स्पष्ट संदेश के साथ समाप्त होता है।',
    [label]: 'मॉडल बदला गया',
    [detail]: '{0} रेट-सीमित है; {1} पर जारी',
  },
  it: {
    [setting]:
      'Modelli a cui passare, in ordine, quando il modello scelto resta limitato nella frequenza (HTTP 429). Usa fornitore/modello o solo un modello. Ognuno viene provato una volta; lascia vuoto per terminare l’esecuzione con un messaggio chiaro.',
    [label]: 'Modello cambiato',
    [detail]: '{0} è limitato nella frequenza; si continua con {1}',
  },
  ja: {
    [setting]:
      '選択したモデルのレート制限 (HTTP 429) が続くとき、順に切り替えるモデル。プロバイダー/モデル、またはモデル名のみで指定します。各モデルは 1 回だけ試されます。空のままにすると、実行は分かりやすいメッセージで終了します。',
    [label]: 'モデルを切り替えました',
    [detail]: '{0} はレート制限中です。{1} で続行します',
  },
  pt: {
    [setting]:
      'Modelos para os quais mudar, em ordem, quando o modelo escolhido continua limitado por taxa (HTTP 429). Use provedor/modelo ou apenas um modelo. Cada um é tentado uma vez; deixe vazio para encerrar a execução com uma mensagem clara.',
    [label]: 'Modelo trocado',
    [detail]: '{0} está limitado por taxa; continuando com {1}',
  },
  ru: {
    [setting]:
      'Модели, на которые по порядку переключаться, если выбранная модель остаётся под ограничением частоты (HTTP 429). Укажите поставщик/модель или только модель. Каждая пробуется один раз; оставьте пустым, чтобы запуск завершался понятным сообщением.',
    [label]: 'Модель переключена',
    [detail]: '{0} ограничена по частоте; продолжаем на {1}',
  },
  th: {
    [setting]:
      'โมเดลที่จะสลับไปตามลำดับเมื่อโมเดลที่เลือกยังถูกจำกัดอัตรา (HTTP 429) ใช้ผู้ให้บริการ/โมเดล หรือชื่อโมเดลอย่างเดียว แต่ละโมเดลจะลองหนึ่งครั้ง เว้นว่างไว้เพื่อให้การรันจบด้วยข้อความที่ชัดเจน',
    [label]: 'สลับโมเดลแล้ว',
    [detail]: '{0} ถูกจำกัดอัตรา; ทำงานต่อด้วย {1}',
  },
  zh: {
    [setting]:
      '所选模型持续被限流 (HTTP 429) 时，按顺序切换到的模型。使用 提供商/模型 或仅模型名。每个只尝试一次；留空则运行以清晰的提示结束。',
    [label]: '已切换模型',
    [detail]: '{0} 被限流；改用 {1} 继续',
  },
};
