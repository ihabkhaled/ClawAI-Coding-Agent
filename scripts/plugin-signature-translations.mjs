// F081 — publisher signatures on marketplace plugins.
const keys = [
  'Signed by {0}',
  'Unsigned',
  'The plugin has no valid signature from a trusted publisher, and the signature policy requires one. Nothing was installed: {0}',
  'Installed {0} without a trusted publisher signature ({1}).',
  "Publishers whose plugin signatures are trusted: a publisher id mapped to a base64 Ed25519 public key (raw 32 bytes or SPKI DER). A marketplace entry carries a detached signature over its canonical JSON; it counts as signed only when it verifies against the key of the entry's `publisher`. A `trustedPluginPublishers` block in the organization policy replaces this list, and a project policy can only narrow it.",
  'What to do with a marketplace plugin that has no valid signature from a trusted publisher: `off` does not check, `warn` installs it with a warning and an Unsigned badge, `require` refuses it.',
];

const values = {
  ar: [
    'موقّعة من {0}',
    'غير موقّعة',
    'لا تحمل الإضافة توقيعًا صالحًا من ناشر موثوق، وسياسة التوقيع تشترط ذلك. لم يتم تثبيت أي شيء: {0}',
    'تم تثبيت {0} دون توقيع ناشر موثوق ({1}).',
    'الناشرون الذين يُوثق بتوقيعات إضافاتهم: معرّف ناشر مربوط بمفتاح عام Ed25519 بترميز base64 (32 بايت خام أو SPKI DER). يحمل إدخال السوق توقيعًا منفصلًا على JSON القانوني الخاص به، ولا يُعد موقّعًا إلا إذا تم التحقق منه بمفتاح `publisher` الخاص بالإدخال. كتلة `trustedPluginPublishers` في سياسة المؤسسة تحل محل هذه القائمة، وسياسة المشروع لا يمكنها إلا التضييق.',
    'ما يجب فعله مع إضافة من السوق ليس لها توقيع صالح من ناشر موثوق: `off` لا يتحقق، و`warn` يثبتها مع تحذير وشارة «غير موقّعة»، و`require` يرفضها.',
  ],
  de: [
    'Signiert von {0}',
    'Nicht signiert',
    'Das Plugin hat keine gültige Signatur eines vertrauenswürdigen Herausgebers, und die Signaturrichtlinie verlangt eine. Es wurde nichts installiert: {0}',
    '{0} wurde ohne Signatur eines vertrauenswürdigen Herausgebers installiert ({1}).',
    'Herausgeber, deren Plugin-Signaturen vertraut wird: eine Herausgeber-ID, zugeordnet zu einem base64-codierten öffentlichen Ed25519-Schlüssel (32 Rohbytes oder SPKI-DER). Ein Marktplatzeintrag trägt eine abgetrennte Signatur über sein kanonisches JSON; er gilt nur als signiert, wenn sie mit dem Schlüssel des `publisher` des Eintrags geprüft werden kann. Ein `trustedPluginPublishers`-Block in der Organisationsrichtlinie ersetzt diese Liste, und eine Projektrichtlinie kann sie nur einschränken.',
    'Was mit einem Marktplatz-Plugin geschieht, das keine gültige Signatur eines vertrauenswürdigen Herausgebers hat: `off` prüft nicht, `warn` installiert es mit einer Warnung und dem Hinweis „Nicht signiert“, `require` lehnt es ab.',
  ],
  es: [
    'Firmado por {0}',
    'Sin firmar',
    'El complemento no tiene una firma válida de un editor de confianza y la directiva de firmas la exige. No se instaló nada: {0}',
    'Se instaló {0} sin la firma de un editor de confianza ({1}).',
    'Editores cuyas firmas de complementos son de confianza: un id de editor asignado a una clave pública Ed25519 en base64 (32 bytes sin procesar o SPKI DER). Una entrada del mercado lleva una firma separada sobre su JSON canónico; solo cuenta como firmada si se verifica con la clave del `publisher` de la entrada. Un bloque `trustedPluginPublishers` en la directiva de la organización reemplaza esta lista, y la directiva de un proyecto solo puede restringirla.',
    'Qué hacer con un complemento del mercado que no tiene una firma válida de un editor de confianza: `off` no comprueba, `warn` lo instala con una advertencia y la insignia Sin firmar, `require` lo rechaza.',
  ],
  fa: [
    'امضا شده توسط {0}',
    'بدون امضا',
    'افزونه امضای معتبری از یک ناشر مورد اعتماد ندارد و سیاست امضا آن را الزامی می‌کند. چیزی نصب نشد: {0}',
    '{0} بدون امضای ناشر مورد اعتماد نصب شد ({1}).',
    'ناشرانی که امضای افزونه‌های آن‌ها مورد اعتماد است: شناسه ناشر که به یک کلید عمومی Ed25519 با کدگذاری base64 (۳۲ بایت خام یا SPKI DER) نگاشت می‌شود. هر ورودی بازار یک امضای جدا از داده روی JSON استاندارد خود دارد و فقط وقتی امضاشده به حساب می‌آید که با کلید `publisher` همان ورودی تأیید شود. بلوک `trustedPluginPublishers` در سیاست سازمان جایگزین این فهرست می‌شود و سیاست پروژه فقط می‌تواند آن را محدودتر کند.',
    'با افزونه‌ای از بازار که امضای معتبر یک ناشر مورد اعتماد را ندارد چه شود: `off` بررسی نمی‌کند، `warn` آن را با هشدار و نشان «بدون امضا» نصب می‌کند، `require` آن را رد می‌کند.',
  ],
  fr: [
    'Signé par {0}',
    'Non signé',
    'Le plugin n’a pas de signature valide d’un éditeur de confiance, et la politique de signature l’exige. Rien n’a été installé : {0}',
    '{0} a été installé sans signature d’un éditeur de confiance ({1}).',
    'Éditeurs dont les signatures de plugins sont approuvées : un identifiant d’éditeur associé à une clé publique Ed25519 en base64 (32 octets bruts ou SPKI DER). Une entrée de marketplace porte une signature détachée sur son JSON canonique ; elle n’est signée que si elle se vérifie avec la clé du `publisher` de l’entrée. Un bloc `trustedPluginPublishers` dans la politique de l’organisation remplace cette liste, et la politique d’un projet ne peut que la restreindre.',
    'Que faire d’un plugin de marketplace sans signature valide d’un éditeur de confiance : `off` ne vérifie pas, `warn` l’installe avec un avertissement et un badge Non signé, `require` le refuse.',
  ],
  hi: [
    '{0} द्वारा हस्ताक्षरित',
    'हस्ताक्षर रहित',
    'प्लगइन पर किसी भरोसेमंद प्रकाशक का वैध हस्ताक्षर नहीं है, और हस्ताक्षर नीति इसे अनिवार्य करती है। कुछ भी इंस्टॉल नहीं हुआ: {0}',
    '{0} को भरोसेमंद प्रकाशक के हस्ताक्षर के बिना इंस्टॉल किया गया ({1})।',
    'वे प्रकाशक जिनके प्लगइन हस्ताक्षरों पर भरोसा किया जाता है: प्रकाशक आईडी जो base64 Ed25519 सार्वजनिक कुंजी (32 कच्चे बाइट या SPKI DER) से जुड़ी हो। मार्केटप्लेस प्रविष्टि अपने कैनोनिकल JSON पर अलग हस्ताक्षर रखती है; वह तभी हस्ताक्षरित मानी जाती है जब प्रविष्टि के `publisher` की कुंजी से सत्यापित हो। संगठन नीति का `trustedPluginPublishers` ब्लॉक इस सूची को बदल देता है, और प्रोजेक्ट नीति इसे केवल सीमित कर सकती है।',
    'किसी भरोसेमंद प्रकाशक के वैध हस्ताक्षर के बिना मार्केटप्लेस प्लगइन का क्या करें: `off` जाँच नहीं करता, `warn` चेतावनी और «हस्ताक्षर रहित» बैज के साथ इंस्टॉल करता है, `require` उसे अस्वीकार करता है।',
  ],
  it: [
    'Firmato da {0}',
    'Non firmato',
    'Il plugin non ha una firma valida di un editore attendibile e la policy delle firme la richiede. Non è stato installato nulla: {0}',
    '{0} è stato installato senza la firma di un editore attendibile ({1}).',
    'Editori le cui firme dei plugin sono attendibili: un id editore associato a una chiave pubblica Ed25519 in base64 (32 byte grezzi o SPKI DER). Una voce del marketplace porta una firma separata sul proprio JSON canonico; conta come firmata solo se si verifica con la chiave del `publisher` della voce. Un blocco `trustedPluginPublishers` nella policy dell’organizzazione sostituisce questo elenco e la policy di un progetto può solo restringerlo.',
    'Cosa fare con un plugin del marketplace privo di una firma valida di un editore attendibile: `off` non controlla, `warn` lo installa con un avviso e il badge Non firmato, `require` lo rifiuta.',
  ],
  ja: [
    '{0} が署名',
    '未署名',
    'このプラグインには信頼できる発行元の有効な署名がなく、署名ポリシーで必須とされています。何もインストールされていません: {0}',
    '{0} は信頼できる発行元の署名なしでインストールされました ({1})。',

    'プラグイン署名を信頼する発行元: 発行元 ID と base64 の Ed25519 公開鍵 (生の 32 バイトまたは SPKI DER) の対応。マーケットプレース項目は正規化した JSON に対する分離署名を持ち、項目の `publisher` の鍵で検証できた場合のみ署名済みとみなされます。組織ポリシーの `trustedPluginPublishers` ブロックはこの一覧を置き換え、プロジェクトポリシーは絞り込みのみ可能です。',
    '信頼できる発行元の有効な署名がないマーケットプレースのプラグインの扱い: `off` は確認せず、`warn` は警告と「未署名」バッジ付きでインストールし、`require` は拒否します。',
  ],
  pt: [
    'Assinado por {0}',
    'Não assinado',
    'O plugin não tem uma assinatura válida de um editor confiável e a política de assinatura a exige. Nada foi instalado: {0}',
    '{0} foi instalado sem a assinatura de um editor confiável ({1}).',
    'Editores cujas assinaturas de plugins são confiáveis: um id de editor associado a uma chave pública Ed25519 em base64 (32 bytes brutos ou SPKI DER). Uma entrada do marketplace traz uma assinatura separada sobre o seu JSON canônico; só conta como assinada se for verificada com a chave do `publisher` da entrada. Um bloco `trustedPluginPublishers` na política da organização substitui esta lista, e a política de um projeto só pode restringi-la.',
    'O que fazer com um plugin do marketplace sem assinatura válida de um editor confiável: `off` não verifica, `warn` instala com um aviso e o selo Não assinado, `require` recusa.',
  ],
  ru: [
    'Подписано: {0}',
    'Без подписи',
    'У плагина нет действительной подписи доверенного издателя, а политика подписей её требует. Ничего не установлено: {0}',
    '{0} установлен без подписи доверенного издателя ({1}).',
    'Издатели, подписям плагинов которых доверяют: идентификатор издателя, сопоставленный с открытым ключом Ed25519 в base64 (32 байта или SPKI DER). Запись маркетплейса содержит отделённую подпись канонического JSON; она считается подписанной, только если проверяется ключом `publisher` этой записи. Блок `trustedPluginPublishers` в политике организации заменяет этот список, а политика проекта может лишь сузить его.',
    'Что делать с плагином маркетплейса без действительной подписи доверенного издателя: `off` не проверяет, `warn` устанавливает с предупреждением и значком «Без подписи», `require` отклоняет.',
  ],
  th: [
    'ลงนามโดย {0}',
    'ไม่ได้ลงนาม',
    'ปลั๊กอินไม่มีลายเซ็นที่ถูกต้องจากผู้เผยแพร่ที่เชื่อถือได้ และนโยบายลายเซ็นกำหนดให้ต้องมี จึงไม่ได้ติดตั้งสิ่งใด: {0}',
    'ติดตั้ง {0} โดยไม่มีลายเซ็นจากผู้เผยแพร่ที่เชื่อถือได้ ({1})',
    'ผู้เผยแพร่ที่เชื่อถือลายเซ็นปลั๊กอิน: รหัสผู้เผยแพร่ที่จับคู่กับกุญแจสาธารณะ Ed25519 แบบ base64 (ดิบ 32 ไบต์หรือ SPKI DER) รายการในตลาดมีลายเซ็นแยกบน JSON มาตรฐานของตัวเอง และจะนับว่าลงนามแล้วก็ต่อเมื่อตรวจสอบได้ด้วยกุญแจของ `publisher` ในรายการนั้น บล็อก `trustedPluginPublishers` ในนโยบายองค์กรจะแทนที่รายการนี้ และนโยบายโปรเจกต์ทำได้เพียงจำกัดให้แคบลง',
    'ต้องทำอย่างไรกับปลั๊กอินในตลาดที่ไม่มีลายเซ็นที่ถูกต้องจากผู้เผยแพร่ที่เชื่อถือได้: `off` ไม่ตรวจสอบ, `warn` ติดตั้งพร้อมคำเตือนและป้าย «ไม่ได้ลงนาม», `require` ปฏิเสธ',
  ],
  zh: [
    '由 {0} 签名',
    '未签名',
    '该插件没有受信任发布者的有效签名，而签名策略要求必须具备。未安装任何内容：{0}',
    '已安装 {0}，但没有受信任发布者的签名（{1}）。',
    '其插件签名受信任的发布者：发布者 ID 对应 base64 编码的 Ed25519 公钥（32 字节原始密钥或 SPKI DER）。市场条目带有针对其规范 JSON 的分离签名，只有用该条目 `publisher` 的密钥验证通过才算已签名。组织策略中的 `trustedPluginPublishers` 块会取代此列表，项目策略只能进一步收窄。',
    '对于没有受信任发布者有效签名的市场插件如何处理：`off` 不检查，`warn` 会带警告和“未签名”标记安装，`require` 则拒绝。',
  ],
};

export const pluginSignatureTranslations = Object.fromEntries(
  Object.entries(values).map(([locale, list]) => [
    locale,
    Object.fromEntries(keys.map((key, index) => [key, list[index]])),
  ]),
);
