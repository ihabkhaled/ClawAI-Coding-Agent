// Translations for the built-in /security-review description (F106) and the
// telemetry headers moved into SecretStorage (F108). Keyed by the English
// message so a new string cannot shift another's translation.

const SKILL = 'Review the pending change for security issues and scan dependencies';
const PROMPT =
  'Telemetry headers as a JSON object of header names and values, such as an authorization header. Stored in the OS keychain. Leave empty to remove them.';
const INVALID =
  'Enter a JSON object whose keys are header names and whose values are text, at most 32 entries.';
const REMOVED = 'Telemetry headers removed.';
const SAVED = 'Telemetry headers saved to the OS keychain.';
const COMMAND = 'Set Telemetry Headers';
const SETTING =
  'Deprecated. Telemetry headers are kept in the OS keychain: run ClawAI: Set Telemetry Headers. A value left here is moved there once and then cleared.';

const entries = (list) =>
  Object.fromEntries(
    [SKILL, PROMPT, INVALID, REMOVED, SAVED, COMMAND, SETTING].map((key, index) => [
      key,
      list[index],
    ]),
  );

export const securityTelemetryTranslations = {
  ar: entries([
    'مراجعة التغيير المعلّق بحثًا عن مشكلات أمنية وفحص التبعيات',
    'ترويسات القياسات ككائن JSON من أسماء الترويسات وقيمها، مثل ترويسة التفويض. تُحفظ في سلسلة مفاتيح نظام التشغيل. اتركها فارغة لإزالتها.',
    'أدخل كائن JSON مفاتيحه أسماء ترويسات وقيمه نصوص، بحد أقصى 32 إدخالًا.',
    'أُزيلت ترويسات القياسات.',
    'حُفظت ترويسات القياسات في سلسلة مفاتيح نظام التشغيل.',
    'تعيين ترويسات القياسات',
    'مهمل. تُحفظ ترويسات القياسات في سلسلة مفاتيح نظام التشغيل: شغّل ClawAI: Set Telemetry Headers. أي قيمة متروكة هنا تُنقل إلى هناك مرة واحدة ثم تُمسح.',
  ]),
  de: entries([
    'Die ausstehende Änderung auf Sicherheitsprobleme prüfen und Abhängigkeiten scannen',
    'Telemetrie-Header als JSON-Objekt aus Headernamen und Werten, etwa ein Autorisierungsheader. Wird im Schlüsselbund des Betriebssystems gespeichert. Leer lassen, um sie zu entfernen.',
    'Geben Sie ein JSON-Objekt ein, dessen Schlüssel Headernamen und dessen Werte Text sind, höchstens 32 Einträge.',
    'Telemetrie-Header entfernt.',
    'Telemetrie-Header im Schlüsselbund des Betriebssystems gespeichert.',
    'Telemetrie-Header festlegen',
    'Veraltet. Telemetrie-Header werden im Schlüsselbund des Betriebssystems gespeichert: Führen Sie ClawAI: Set Telemetry Headers aus. Ein hier verbliebener Wert wird einmal dorthin verschoben und dann gelöscht.',
  ]),
  es: entries([
    'Revisar el cambio pendiente en busca de problemas de seguridad y analizar las dependencias',
    'Cabeceras de telemetría como un objeto JSON de nombres de cabecera y valores, como una cabecera de autorización. Se guardan en el llavero del sistema operativo. Déjalo vacío para eliminarlas.',
    'Introduce un objeto JSON cuyas claves sean nombres de cabecera y cuyos valores sean texto, con un máximo de 32 entradas.',
    'Cabeceras de telemetría eliminadas.',
    'Cabeceras de telemetría guardadas en el llavero del sistema operativo.',
    'Establecer cabeceras de telemetría',
    'Obsoleto. Las cabeceras de telemetría se guardan en el llavero del sistema operativo: ejecuta ClawAI: Set Telemetry Headers. Un valor dejado aquí se mueve allí una vez y luego se borra.',
  ]),
  fa: entries([
    'بررسی تغییر در انتظار از نظر مشکلات امنیتی و پویش وابستگی‌ها',
    'سرآیندهای تله‌متری به‌صورت یک شیء JSON از نام سرآیندها و مقدارها، مانند سرآیند مجوز. در جاکلیدی سیستم‌عامل ذخیره می‌شود. برای حذف، خالی بگذارید.',
    'یک شیء JSON وارد کنید که کلیدهایش نام سرآیند و مقدارهایش متن باشند، حداکثر ۳۲ مورد.',
    'سرآیندهای تله‌متری حذف شدند.',
    'سرآیندهای تله‌متری در جاکلیدی سیستم‌عامل ذخیره شدند.',
    'تنظیم سرآیندهای تله‌متری',
    'منسوخ. سرآیندهای تله‌متری در جاکلیدی سیستم‌عامل نگهداری می‌شوند: ClawAI: Set Telemetry Headers را اجرا کنید. مقداری که اینجا بماند یک بار به آنجا منتقل و سپس پاک می‌شود.',
  ]),
  fr: entries([
    'Examiner la modification en attente pour détecter les problèmes de sécurité et analyser les dépendances',
    'En-têtes de télémétrie sous forme d’objet JSON de noms d’en-tête et de valeurs, comme un en-tête d’autorisation. Stockés dans le trousseau du système d’exploitation. Laissez vide pour les supprimer.',
    'Saisissez un objet JSON dont les clés sont des noms d’en-tête et les valeurs du texte, 32 entrées au maximum.',
    'En-têtes de télémétrie supprimés.',
    'En-têtes de télémétrie enregistrés dans le trousseau du système d’exploitation.',
    'Définir les en-têtes de télémétrie',
    'Obsolète. Les en-têtes de télémétrie sont conservés dans le trousseau du système d’exploitation : exécutez ClawAI: Set Telemetry Headers. Une valeur laissée ici y est déplacée une fois, puis effacée.',
  ]),
  hi: entries([
    'लंबित बदलाव में सुरक्षा समस्याओं की समीक्षा करें और निर्भरताओं को स्कैन करें',
    'टेलीमेट्री हेडर, हेडर नामों और मानों वाले JSON ऑब्जेक्ट के रूप में, जैसे एक ऑथराइज़ेशन हेडर। ऑपरेटिंग सिस्टम की कीचेन में सहेजे जाते हैं। हटाने के लिए खाली छोड़ें।',
    'ऐसा JSON ऑब्जेक्ट दर्ज करें जिसकी कुंजियाँ हेडर नाम हों और मान टेक्स्ट हों, अधिकतम 32 प्रविष्टियाँ।',
    'टेलीमेट्री हेडर हटा दिए गए।',
    'टेलीमेट्री हेडर ऑपरेटिंग सिस्टम की कीचेन में सहेजे गए।',
    'टेलीमेट्री हेडर सेट करें',
    'अप्रचलित। टेलीमेट्री हेडर ऑपरेटिंग सिस्टम की कीचेन में रखे जाते हैं: ClawAI: Set Telemetry Headers चलाएँ। यहाँ छोड़ा गया मान एक बार वहाँ ले जाया जाता है और फिर हटा दिया जाता है।',
  ]),
  it: entries([
    'Esamina la modifica in sospeso alla ricerca di problemi di sicurezza e analizza le dipendenze',
    'Intestazioni di telemetria come oggetto JSON di nomi di intestazione e valori, ad esempio un’intestazione di autorizzazione. Salvate nel portachiavi del sistema operativo. Lascia vuoto per rimuoverle.',
    'Inserisci un oggetto JSON le cui chiavi sono nomi di intestazione e i cui valori sono testo, al massimo 32 voci.',
    'Intestazioni di telemetria rimosse.',
    'Intestazioni di telemetria salvate nel portachiavi del sistema operativo.',
    'Imposta intestazioni di telemetria',
    'Deprecato. Le intestazioni di telemetria sono conservate nel portachiavi del sistema operativo: esegui ClawAI: Set Telemetry Headers. Un valore lasciato qui viene spostato lì una volta e poi cancellato.',
  ]),
  ja: entries([
    '保留中の変更をセキュリティ上の問題について確認し、依存関係をスキャンします',
    'テレメトリ ヘッダー。ヘッダー名と値の JSON オブジェクトで指定します (例: 認可ヘッダー)。OS のキーチェーンに保存されます。空のままにすると削除されます。',
    'キーがヘッダー名、値がテキストの JSON オブジェクトを入力してください (最大 32 項目)。',
    'テレメトリ ヘッダーを削除しました。',
    'テレメトリ ヘッダーを OS のキーチェーンに保存しました。',
    'テレメトリ ヘッダーを設定',
    '非推奨。テレメトリ ヘッダーは OS のキーチェーンに保存されます: ClawAI: Set Telemetry Headers を実行してください。ここに残っている値は一度だけそちらへ移され、その後消去されます。',
  ]),
  pt: entries([
    'Revisar a alteração pendente em busca de problemas de segurança e analisar as dependências',
    'Cabeçalhos de telemetria como um objeto JSON de nomes de cabeçalho e valores, como um cabeçalho de autorização. Guardados no chaveiro do sistema operacional. Deixe vazio para removê-los.',
    'Insira um objeto JSON cujas chaves sejam nomes de cabeçalho e cujos valores sejam texto, no máximo 32 entradas.',
    'Cabeçalhos de telemetria removidos.',
    'Cabeçalhos de telemetria salvos no chaveiro do sistema operacional.',
    'Definir cabeçalhos de telemetria',
    'Obsoleto. Os cabeçalhos de telemetria ficam no chaveiro do sistema operacional: execute ClawAI: Set Telemetry Headers. Um valor deixado aqui é movido para lá uma vez e depois apagado.',
  ]),
  ru: entries([
    'Проверить ожидающее изменение на проблемы безопасности и просканировать зависимости',
    'Заголовки телеметрии в виде JSON-объекта из имён заголовков и значений, например заголовок авторизации. Хранятся в связке ключей операционной системы. Оставьте пустым, чтобы удалить их.',
    'Введите JSON-объект, ключи которого — имена заголовков, а значения — текст, не более 32 записей.',
    'Заголовки телеметрии удалены.',
    'Заголовки телеметрии сохранены в связке ключей операционной системы.',
    'Задать заголовки телеметрии',
    'Устарело. Заголовки телеметрии хранятся в связке ключей операционной системы: выполните ClawAI: Set Telemetry Headers. Оставленное здесь значение один раз переносится туда, а затем удаляется.',
  ]),
  th: entries([
    'ตรวจสอบการเปลี่ยนแปลงที่รอดำเนินการเพื่อหาปัญหาด้านความปลอดภัยและสแกนการพึ่งพา',
    'ส่วนหัวเทเลเมทรีในรูปแบบออบเจ็กต์ JSON ของชื่อส่วนหัวและค่า เช่น ส่วนหัวการอนุญาต จัดเก็บในพวงกุญแจของระบบปฏิบัติการ เว้นว่างไว้เพื่อลบออก',
    'ป้อนออบเจ็กต์ JSON ที่คีย์เป็นชื่อส่วนหัวและค่าเป็นข้อความ ไม่เกิน 32 รายการ',
    'ลบส่วนหัวเทเลเมทรีแล้ว',
    'บันทึกส่วนหัวเทเลเมทรีลงในพวงกุญแจของระบบปฏิบัติการแล้ว',
    'ตั้งค่าส่วนหัวเทเลเมทรี',
    'เลิกใช้แล้ว ส่วนหัวเทเลเมทรีถูกเก็บไว้ในพวงกุญแจของระบบปฏิบัติการ: เรียกใช้ ClawAI: Set Telemetry Headers ค่าที่เหลืออยู่ที่นี่จะถูกย้ายไปที่นั่นหนึ่งครั้งแล้วล้างออก',
  ]),
  zh: entries([
    '审查待处理的更改是否存在安全问题并扫描依赖项',
    '遥测标头，以标头名称和值组成的 JSON 对象表示，例如授权标头。存储在操作系统钥匙串中。留空即可删除。',
    '请输入一个 JSON 对象，其键为标头名称、值为文本，最多 32 项。',
    '已删除遥测标头。',
    '已将遥测标头保存到操作系统钥匙串。',
    '设置遥测标头',
    '已弃用。遥测标头保存在操作系统钥匙串中：请运行 ClawAI: Set Telemetry Headers。留在此处的值会被移过去一次，然后清除。',
  ]),
};
