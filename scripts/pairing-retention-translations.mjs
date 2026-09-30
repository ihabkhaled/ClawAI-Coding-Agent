// F097 pairing QR panel and F055 zero-retention hardening (compare refusal, Show Usage).
const K = {
  compare:
    'Zero data retention is on, so models are not compared: every answer of a comparison is stored on the server.',
  heading: 'Zero data retention',
  off: 'Off. Chats are stored as usual.',
  org: 'On, required by your organization.',
  setting: 'On, turned on by your setting.',
  effect:
    'Nothing is kept after a turn, and comparing models, uploads, publishing and sharing are refused.',
  scan: 'Scan this code with your phone camera, signed in to ClawAI, then approve this editor.',
  qr: 'QR code with the pairing link',
  open: 'Or open this link',
  tooLong: 'This link is too long for a QR code. Copy it instead.',
  copied: 'Link copied.',
};

function entries(values) {
  return Object.fromEntries(Object.keys(K).map((key) => [K[key], values[key]]));
}

export const pairingRetentionTranslations = {
  ar: entries({
    compare:
      'الاحتفاظ الصفري بالبيانات مُفعّل، لذا لا تتم مقارنة النماذج: كل إجابة في المقارنة تُخزَّن على الخادم.',
    heading: 'الاحتفاظ الصفري بالبيانات',
    off: 'متوقف. تُخزَّن المحادثات كالمعتاد.',
    org: 'مُفعّل بحسب متطلبات مؤسستك.',
    setting: 'مُفعّل بحسب إعدادك.',
    effect: 'لا يُحفظ شيء بعد كل دورة، ويُرفض كل من مقارنة النماذج والرفع والنشر والمشاركة.',
    scan: 'امسح هذا الرمز بكاميرا هاتفك وأنت مسجّل الدخول إلى ClawAI، ثم وافق على هذا المحرر.',
    qr: 'رمز QR يحتوي على رابط الإقران',
    open: 'أو افتح هذا الرابط',
    tooLong: 'هذا الرابط أطول من أن يُحمَّل في رمز QR. انسخه بدلًا من ذلك.',
    copied: 'تم نسخ الرابط.',
  }),
  de: entries({
    compare:
      'Zero Data Retention ist aktiv, daher werden Modelle nicht verglichen: Jede Antwort eines Vergleichs wird auf dem Server gespeichert.',
    heading: 'Zero Data Retention',
    off: 'Aus. Chats werden wie gewohnt gespeichert.',
    org: 'Ein, von Ihrer Organisation vorgeschrieben.',
    setting: 'Ein, durch Ihre Einstellung aktiviert.',
    effect:
      'Nach einem Durchgang wird nichts aufbewahrt; Modellvergleiche, Uploads, Veröffentlichen und Teilen werden abgelehnt.',
    scan: 'Scannen Sie diesen Code mit der Kamera Ihres Smartphones, angemeldet bei ClawAI, und bestätigen Sie dann diesen Editor.',
    qr: 'QR-Code mit dem Kopplungslink',
    open: 'Oder öffnen Sie diesen Link',
    tooLong: 'Dieser Link ist für einen QR-Code zu lang. Kopieren Sie ihn stattdessen.',
    copied: 'Link kopiert.',
  }),
  es: entries({
    compare:
      'La retención cero de datos está activada, así que no se comparan modelos: cada respuesta de una comparación se almacena en el servidor.',
    heading: 'Retención cero de datos',
    off: 'Desactivada. Los chats se almacenan como siempre.',
    org: 'Activada, exigida por su organización.',
    setting: 'Activada por su ajuste.',
    effect:
      'No se conserva nada después de un turno, y se rechazan la comparación de modelos, las subidas, la publicación y el uso compartido.',
    scan: 'Escanee este código con la cámara del teléfono, con la sesión iniciada en ClawAI, y luego apruebe este editor.',
    qr: 'Código QR con el enlace de emparejamiento',
    open: 'O abra este enlace',
    tooLong: 'Este enlace es demasiado largo para un código QR. Cópielo en su lugar.',
    copied: 'Enlace copiado.',
  }),
  fa: entries({
    compare:
      'حفظ صفر داده فعال است، بنابراین مدل‌ها مقایسه نمی‌شوند: هر پاسخ یک مقایسه روی سرور ذخیره می‌شود.',
    heading: 'حفظ صفر داده',
    off: 'خاموش. گفتگوها مثل همیشه ذخیره می‌شوند.',
    org: 'روشن، به‌دلیل الزام سازمان شما.',
    setting: 'روشن، با تنظیم شما.',
    effect:
      'پس از هر نوبت چیزی نگه داشته نمی‌شود و مقایسه مدل‌ها، بارگذاری، انتشار و اشتراک‌گذاری رد می‌شوند.',
    scan: 'این کد را با دوربین گوشی خود و در حالی که وارد ClawAI شده‌اید اسکن کنید، سپس این ویرایشگر را تأیید کنید.',
    qr: 'کد QR حاوی پیوند جفت‌سازی',
    open: 'یا این پیوند را باز کنید',
    tooLong: 'این پیوند برای کد QR بسیار بلند است. به‌جای آن، آن را کپی کنید.',
    copied: 'پیوند کپی شد.',
  }),
  fr: entries({
    compare:
      'La rétention zéro des données est activée, les modèles ne sont donc pas comparés : chaque réponse d’une comparaison est stockée sur le serveur.',
    heading: 'Rétention zéro des données',
    off: 'Désactivée. Les conversations sont stockées comme d’habitude.',
    org: 'Activée, exigée par votre organisation.',
    setting: 'Activée par votre réglage.',
    effect:
      'Rien n’est conservé après un tour, et la comparaison de modèles, les envois, la publication et le partage sont refusés.',
    scan: 'Scannez ce code avec l’appareil photo de votre téléphone, connecté à ClawAI, puis approuvez cet éditeur.',
    qr: 'Code QR contenant le lien d’appairage',
    open: 'Ou ouvrez ce lien',
    tooLong: 'Ce lien est trop long pour un code QR. Copiez-le à la place.',
    copied: 'Lien copié.',
  }),
  hi: entries({
    compare:
      'ज़ीरो डेटा रिटेंशन चालू है, इसलिए मॉडलों की तुलना नहीं की जाती: तुलना का हर उत्तर सर्वर पर संग्रहीत होता है।',
    heading: 'ज़ीरो डेटा रिटेंशन',
    off: 'बंद। चैट पहले की तरह संग्रहीत होती हैं।',
    org: 'चालू, आपके संगठन द्वारा अनिवार्य।',
    setting: 'चालू, आपकी सेटिंग द्वारा।',
    effect:
      'एक टर्न के बाद कुछ भी नहीं रखा जाता, और मॉडल तुलना, अपलोड, प्रकाशन और साझा करना अस्वीकार किए जाते हैं।',
    scan: 'ClawAI में साइन इन रहते हुए अपने फ़ोन के कैमरे से यह कोड स्कैन करें, फिर इस एडिटर को स्वीकृत करें।',
    qr: 'पेयरिंग लिंक वाला QR कोड',
    open: 'या इस लिंक को खोलें',
    tooLong: 'यह लिंक QR कोड के लिए बहुत लंबा है। इसके बजाय इसे कॉपी करें।',
    copied: 'लिंक कॉपी हो गया।',
  }),
  it: entries({
    compare:
      'La conservazione zero dei dati è attiva, quindi i modelli non vengono confrontati: ogni risposta di un confronto viene memorizzata sul server.',
    heading: 'Conservazione zero dei dati',
    off: 'Disattivata. Le chat vengono memorizzate come al solito.',
    org: 'Attiva, richiesta dalla tua organizzazione.',
    setting: 'Attiva per la tua impostazione.',
    effect:
      'Dopo un turno non viene conservato nulla, e il confronto tra modelli, i caricamenti, la pubblicazione e la condivisione sono rifiutati.',
    scan: 'Inquadra questo codice con la fotocamera del telefono, con l’accesso a ClawAI effettuato, poi approva questo editor.',
    qr: 'Codice QR con il link di abbinamento',
    open: 'Oppure apri questo link',
    tooLong: 'Questo link è troppo lungo per un codice QR. Copialo invece.',
    copied: 'Link copiato.',
  }),
  ja: entries({
    compare:
      'ゼロデータ保持が有効なため、モデルの比較は行いません。比較の各回答がサーバーに保存されるためです。',
    heading: 'ゼロデータ保持',
    off: 'オフ。チャットは通常どおり保存されます。',
    org: 'オン（組織により必須）。',
    setting: 'オン（設定によりオン）。',
    effect: 'ターン終了後は何も保持されず、モデルの比較、アップロード、公開、共有は拒否されます。',
    scan: 'ClawAI にサインインした状態でスマートフォンのカメラでこのコードをスキャンし、このエディターを承認してください。',
    qr: 'ペアリングリンクの QR コード',
    open: 'またはこのリンクを開く',
    tooLong: 'このリンクは QR コードには長すぎます。代わりにコピーしてください。',
    copied: 'リンクをコピーしました。',
  }),
  pt: entries({
    compare:
      'A retenção zero de dados está ativa, então os modelos não são comparados: cada resposta de uma comparação é armazenada no servidor.',
    heading: 'Retenção zero de dados',
    off: 'Desativada. As conversas são armazenadas normalmente.',
    org: 'Ativada, exigida pela sua organização.',
    setting: 'Ativada pela sua configuração.',
    effect:
      'Nada é mantido após um turno, e a comparação de modelos, os envios, a publicação e o compartilhamento são recusados.',
    scan: 'Escaneie este código com a câmera do celular, conectado ao ClawAI, e depois aprove este editor.',
    qr: 'Código QR com o link de pareamento',
    open: 'Ou abra este link',
    tooLong: 'Este link é longo demais para um código QR. Copie-o em vez disso.',
    copied: 'Link copiado.',
  }),
  ru: entries({
    compare:
      'Включено нулевое хранение данных, поэтому модели не сравниваются: каждый ответ сравнения сохраняется на сервере.',
    heading: 'Нулевое хранение данных',
    off: 'Выключено. Чаты сохраняются как обычно.',
    org: 'Включено по требованию вашей организации.',
    setting: 'Включено вашей настройкой.',
    effect:
      'После хода ничего не сохраняется, а сравнение моделей, загрузки, публикация и общий доступ отклоняются.',
    scan: 'Отсканируйте этот код камерой телефона, войдя в ClawAI, затем подтвердите этот редактор.',
    qr: 'QR-код со ссылкой для сопряжения',
    open: 'Или откройте эту ссылку',
    tooLong: 'Эта ссылка слишком длинная для QR-кода. Скопируйте её.',
    copied: 'Ссылка скопирована.',
  }),
  th: entries({
    compare:
      'การเก็บข้อมูลเป็นศูนย์เปิดอยู่ จึงไม่เปรียบเทียบโมเดล: ทุกคำตอบของการเปรียบเทียบจะถูกเก็บไว้บนเซิร์ฟเวอร์',
    heading: 'การเก็บข้อมูลเป็นศูนย์',
    off: 'ปิด แชตจะถูกเก็บตามปกติ',
    org: 'เปิด ตามที่องค์กรของคุณกำหนด',
    setting: 'เปิด ตามการตั้งค่าของคุณ',
    effect:
      'จะไม่เก็บสิ่งใดไว้หลังจบแต่ละรอบ และการเปรียบเทียบโมเดล การอัปโหลด การเผยแพร่ และการแชร์จะถูกปฏิเสธ',
    scan: 'สแกนโค้ดนี้ด้วยกล้องโทรศัพท์ขณะที่ลงชื่อเข้าใช้ ClawAI แล้วอนุมัติตัวแก้ไขนี้',
    qr: 'คิวอาร์โค้ดที่มีลิงก์การจับคู่',
    open: 'หรือเปิดลิงก์นี้',
    tooLong: 'ลิงก์นี้ยาวเกินกว่าจะใส่ในคิวอาร์โค้ดได้ ให้คัดลอกแทน',
    copied: 'คัดลอกลิงก์แล้ว',
  }),
  zh: entries({
    compare: '零数据留存已开启，因此不会比较模型：比较中的每个回答都会存储在服务器上。',
    heading: '零数据留存',
    off: '已关闭。聊天照常存储。',
    org: '已开启，由您的组织要求。',
    setting: '已开启，由您的设置开启。',
    effect: '每轮结束后不保留任何内容，并且会拒绝模型比较、上传、发布和分享。',
    scan: '请在已登录 ClawAI 的情况下用手机相机扫描此码，然后批准此编辑器。',
    qr: '包含配对链接的二维码',
    open: '或打开此链接',
    tooLong: '此链接太长，无法生成二维码。请改为复制链接。',
    copied: '链接已复制。',
  }),
};
