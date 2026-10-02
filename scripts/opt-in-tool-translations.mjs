// Opt-in tools (HTTP and shell): the approval card lines and the three settings descriptions.
const settingHosts =
  'Web servers the agent may send requests to with the HTTP tool, such as localhost:3000 or *.example.com. Empty means the HTTP tool is off. Changes to data on a server are always asked about. Only your own user settings count; a project cannot turn this on.';
const settingShell =
  'Let the agent run scripts in a real shell, for pipes, && and redirects. Off by default. Every script is shown to you and needs your approval first. Only your own user settings count; a project cannot turn this on.';
const settingDeny =
  'Extra patterns (regular expressions) that make the shell tool refuse a script, on top of the built-in safety screen. Only your own user settings count.';

export const optInToolTranslations = {
  ar: {
    'Run a shell script': 'تشغيل سكربت في الصدفة',
    'Send data to a web server': 'إرسال بيانات إلى خادم ويب',
    'Read from a web server': 'القراءة من خادم ويب',
    'Open a page in the browser': 'فتح صفحة في المتصفح',
    'Run {0}': 'تشغيل {0}',
    [settingHosts]:
      'خوادم الويب التي يمكن للوكيل إرسال طلبات إليها بأداة HTTP، مثل localhost:3000 أو *.example.com. القائمة الفارغة تعني أن أداة HTTP متوقفة. يُسأل دائماً قبل أي تغيير للبيانات على الخادم. تُحتسب إعدادات المستخدم الخاصة بك فقط؛ لا يمكن لمشروع تفعيل ذلك.',
    [settingShell]:
      'السماح للوكيل بتشغيل سكربتات في صدفة حقيقية لاستخدام الأنابيب و&& وإعادة التوجيه. متوقف افتراضياً. يُعرض لك كل سكربت ويحتاج إلى موافقتك أولاً. تُحتسب إعدادات المستخدم الخاصة بك فقط؛ لا يمكن لمشروع تفعيل ذلك.',
    [settingDeny]:
      'أنماط إضافية (تعابير نمطية) تجعل أداة الصدفة ترفض سكربتاً، فوق فحص الأمان المدمج. تُحتسب إعدادات المستخدم الخاصة بك فقط.',
  },
  de: {
    'Run a shell script': 'Shell-Skript ausführen',
    'Send data to a web server': 'Daten an einen Webserver senden',
    'Read from a web server': 'Von einem Webserver lesen',
    'Open a page in the browser': 'Eine Seite im Browser öffnen',
    'Run {0}': '{0} ausführen',
    [settingHosts]:
      'Webserver, an die der Agent mit dem HTTP-Werkzeug Anfragen senden darf, etwa localhost:3000 oder *.example.com. Leer bedeutet, dass das HTTP-Werkzeug aus ist. Änderungen an Daten auf einem Server werden immer erfragt. Nur Ihre eigenen Benutzereinstellungen zählen; ein Projekt kann dies nicht einschalten.',
    [settingShell]:
      'Erlaubt dem Agenten, Skripte in einer echten Shell auszuführen, für Pipes, && und Umleitungen. Standardmäßig aus. Jedes Skript wird Ihnen gezeigt und braucht zuerst Ihre Zustimmung. Nur Ihre eigenen Benutzereinstellungen zählen; ein Projekt kann dies nicht einschalten.',
    [settingDeny]:
      'Zusätzliche Muster (reguläre Ausdrücke), bei denen das Shell-Werkzeug ein Skript ablehnt, zusätzlich zur eingebauten Sicherheitsprüfung. Nur Ihre eigenen Benutzereinstellungen zählen.',
  },
  es: {
    'Run a shell script': 'Ejecutar un script de shell',
    'Send data to a web server': 'Enviar datos a un servidor web',
    'Read from a web server': 'Leer de un servidor web',
    'Open a page in the browser': 'Abrir una página en el navegador',
    'Run {0}': 'Ejecutar {0}',
    [settingHosts]:
      'Servidores web a los que el agente puede enviar solicitudes con la herramienta HTTP, como localhost:3000 o *.example.com. Vacío significa que la herramienta HTTP está desactivada. Los cambios de datos en un servidor siempre se consultan. Solo cuentan tus ajustes de usuario; un proyecto no puede activarlo.',
    [settingShell]:
      'Permite al agente ejecutar scripts en un shell real, para tuberías, && y redirecciones. Desactivado por defecto. Cada script se te muestra y necesita tu aprobación antes. Solo cuentan tus ajustes de usuario; un proyecto no puede activarlo.',
    [settingDeny]:
      'Patrones adicionales (expresiones regulares) por los que la herramienta de shell rechaza un script, además del filtro de seguridad integrado. Solo cuentan tus ajustes de usuario.',
  },
  fa: {
    'Run a shell script': 'اجرای یک اسکریپت شل',
    'Send data to a web server': 'ارسال داده به یک وب‌سرور',
    'Read from a web server': 'خواندن از یک وب‌سرور',
    'Open a page in the browser': 'باز کردن یک صفحه در مرورگر',
    'Run {0}': 'اجرای {0}',
    [settingHosts]:
      'وب‌سرورهایی که عامل می‌تواند با ابزار HTTP به آن‌ها درخواست بفرستد، مانند localhost:3000 یا *.example.com. خالی یعنی ابزار HTTP خاموش است. تغییر داده‌ها روی سرور همیشه از شما پرسیده می‌شود. فقط تنظیمات کاربری خودتان اثر دارد؛ یک پروژه نمی‌تواند این را روشن کند.',
    [settingShell]:
      'به عامل اجازه می‌دهد اسکریپت‌ها را در یک شل واقعی اجرا کند، برای پایپ، && و تغییر مسیر. به‌طور پیش‌فرض خاموش است. هر اسکریپت به شما نشان داده می‌شود و ابتدا به تأیید شما نیاز دارد. فقط تنظیمات کاربری خودتان اثر دارد؛ یک پروژه نمی‌تواند این را روشن کند.',
    [settingDeny]:
      'الگوهای اضافی (عبارت‌های باقاعده) که ابزار شل بر اساس آن‌ها یک اسکریپت را رد می‌کند، علاوه بر بررسی ایمنی داخلی. فقط تنظیمات کاربری خودتان اثر دارد.',
  },
  fr: {
    'Run a shell script': 'Exécuter un script shell',
    'Send data to a web server': 'Envoyer des données à un serveur web',
    'Read from a web server': 'Lire depuis un serveur web',
    'Open a page in the browser': 'Ouvrir une page dans le navigateur',
    'Run {0}': 'Exécuter {0}',
    [settingHosts]:
      "Serveurs web auxquels l'agent peut envoyer des requêtes avec l'outil HTTP, comme localhost:3000 ou *.example.com. Vide signifie que l'outil HTTP est désactivé. Toute modification de données sur un serveur est toujours soumise à validation. Seuls vos paramètres utilisateur comptent ; un projet ne peut pas l'activer.",
    [settingShell]:
      "Autorise l'agent à exécuter des scripts dans un vrai shell, pour les tubes, && et les redirections. Désactivé par défaut. Chaque script vous est montré et requiert d'abord votre accord. Seuls vos paramètres utilisateur comptent ; un projet ne peut pas l'activer.",
    [settingDeny]:
      "Motifs supplémentaires (expressions régulières) qui font refuser un script par l'outil shell, en plus du filtre de sécurité intégré. Seuls vos paramètres utilisateur comptent.",
  },
  hi: {
    'Run a shell script': 'शेल स्क्रिप्ट चलाएँ',
    'Send data to a web server': 'वेब सर्वर को डेटा भेजें',
    'Read from a web server': 'वेब सर्वर से पढ़ें',
    'Open a page in the browser': 'ब्राउज़र में एक पेज खोलें',
    'Run {0}': '{0} चलाएँ',
    [settingHosts]:
      'वे वेब सर्वर जिन्हें एजेंट HTTP टूल से अनुरोध भेज सकता है, जैसे localhost:3000 या *.example.com। खाली होने पर HTTP टूल बंद रहता है। सर्वर पर डेटा बदलने से पहले हमेशा पूछा जाता है। केवल आपकी अपनी उपयोगकर्ता सेटिंग मान्य है; कोई प्रोजेक्ट इसे चालू नहीं कर सकता।',
    [settingShell]:
      'एजेंट को असली शेल में स्क्रिप्ट चलाने दें, पाइप, && और रीडायरेक्ट के लिए। डिफ़ॉल्ट रूप से बंद। हर स्क्रिप्ट आपको दिखाई जाती है और पहले आपकी मंज़ूरी चाहिए। केवल आपकी अपनी उपयोगकर्ता सेटिंग मान्य है; कोई प्रोजेक्ट इसे चालू नहीं कर सकता।',
    [settingDeny]:
      'अतिरिक्त पैटर्न (रेगुलर एक्सप्रेशन) जिन पर शेल टूल किसी स्क्रिप्ट को मना कर देता है, बिल्ट-इन सुरक्षा जाँच के अलावा। केवल आपकी अपनी उपयोगकर्ता सेटिंग मान्य है।',
  },
  it: {
    'Run a shell script': 'Esegui uno script shell',
    'Send data to a web server': 'Invia dati a un server web',
    'Read from a web server': 'Leggi da un server web',
    'Open a page in the browser': 'Apri una pagina nel browser',
    'Run {0}': 'Esegui {0}',
    [settingHosts]:
      "Server web a cui l'agente può inviare richieste con lo strumento HTTP, come localhost:3000 o *.example.com. Vuoto significa che lo strumento HTTP è disattivato. Le modifiche ai dati su un server vengono sempre chieste. Contano solo le tue impostazioni utente; un progetto non può attivarlo.",
    [settingShell]:
      "Consente all'agente di eseguire script in una vera shell, per pipe, && e reindirizzamenti. Disattivato per impostazione predefinita. Ogni script ti viene mostrato e richiede prima la tua approvazione. Contano solo le tue impostazioni utente; un progetto non può attivarlo.",
    [settingDeny]:
      'Modelli aggiuntivi (espressioni regolari) per cui lo strumento shell rifiuta uno script, oltre al controllo di sicurezza integrato. Contano solo le tue impostazioni utente.',
  },
  ja: {
    'Run a shell script': 'シェルスクリプトを実行',
    'Send data to a web server': 'Web サーバーにデータを送信',
    'Read from a web server': 'Web サーバーから読み取り',
    'Open a page in the browser': 'ブラウザーでページを開く',
    'Run {0}': '{0} を実行',
    [settingHosts]:
      'エージェントが HTTP ツールでリクエストを送れる Web サーバー（localhost:3000 や *.example.com など）。空の場合は HTTP ツールがオフです。サーバー上のデータを変更する場合は常に確認します。有効なのはあなた自身のユーザー設定のみで、プロジェクト側からはオンにできません。',
    [settingShell]:
      'パイプや && やリダイレクトのために、エージェントが実際のシェルでスクリプトを実行できるようにします。既定ではオフです。スクリプトは毎回表示され、先にあなたの承認が必要です。有効なのはあなた自身のユーザー設定のみで、プロジェクト側からはオンにできません。',
    [settingDeny]:
      '組み込みの安全チェックに加えて、シェルツールがスクリプトを拒否する追加パターン（正規表現）。有効なのはあなた自身のユーザー設定のみです。',
  },
  pt: {
    'Run a shell script': 'Executar um script de shell',
    'Send data to a web server': 'Enviar dados a um servidor web',
    'Read from a web server': 'Ler de um servidor web',
    'Open a page in the browser': 'Abrir uma página no navegador',
    'Run {0}': 'Executar {0}',
    [settingHosts]:
      'Servidores web aos quais o agente pode enviar solicitações com a ferramenta HTTP, como localhost:3000 ou *.example.com. Vazio significa que a ferramenta HTTP está desligada. Alterações de dados em um servidor são sempre confirmadas. Só valem suas próprias configurações de usuário; um projeto não pode ativar isto.',
    [settingShell]:
      'Permite que o agente execute scripts em um shell real, para pipes, && e redirecionamentos. Desligado por padrão. Cada script é mostrado a você e precisa da sua aprovação antes. Só valem suas próprias configurações de usuário; um projeto não pode ativar isto.',
    [settingDeny]:
      'Padrões extras (expressões regulares) que fazem a ferramenta de shell recusar um script, além da verificação de segurança embutida. Só valem suas próprias configurações de usuário.',
  },
  ru: {
    'Run a shell script': 'Запустить shell-скрипт',
    'Send data to a web server': 'Отправить данные на веб-сервер',
    'Read from a web server': 'Прочитать с веб-сервера',
    'Open a page in the browser': 'Открыть страницу в браузере',
    'Run {0}': 'Выполнить {0}',
    [settingHosts]:
      'Веб-серверы, на которые агент может отправлять запросы инструментом HTTP, например localhost:3000 или *.example.com. Пусто означает, что инструмент HTTP выключен. Изменение данных на сервере всегда требует подтверждения. Учитываются только ваши собственные пользовательские настройки; проект не может это включить.',
    [settingShell]:
      'Разрешает агенту запускать скрипты в настоящей оболочке, для конвейеров, && и перенаправлений. По умолчанию выключено. Каждый скрипт показывается вам и сначала требует вашего подтверждения. Учитываются только ваши собственные пользовательские настройки; проект не может это включить.',
    [settingDeny]:
      'Дополнительные шаблоны (регулярные выражения), по которым инструмент оболочки отклоняет скрипт, сверх встроенной проверки безопасности. Учитываются только ваши собственные пользовательские настройки.',
  },
  th: {
    'Run a shell script': 'รันสคริปต์เชลล์',
    'Send data to a web server': 'ส่งข้อมูลไปยังเว็บเซิร์ฟเวอร์',
    'Read from a web server': 'อ่านจากเว็บเซิร์ฟเวอร์',
    'Open a page in the browser': 'เปิดหน้าในเบราว์เซอร์',
    'Run {0}': 'รัน {0}',
    [settingHosts]:
      'เว็บเซิร์ฟเวอร์ที่เอเจนต์ส่งคำขอไปได้ด้วยเครื่องมือ HTTP เช่น localhost:3000 หรือ *.example.com หากว่างหมายถึงปิดเครื่องมือ HTTP การเปลี่ยนแปลงข้อมูลบนเซิร์ฟเวอร์จะถามเสมอ ใช้เฉพาะการตั้งค่าผู้ใช้ของคุณเอง โปรเจกต์เปิดสิ่งนี้ไม่ได้',
    [settingShell]:
      'ให้เอเจนต์รันสคริปต์ในเชลล์จริง สำหรับไปป์ && และการเปลี่ยนเส้นทาง ปิดไว้เป็นค่าเริ่มต้น ทุกสคริปต์จะแสดงให้คุณดูและต้องได้รับการอนุมัติจากคุณก่อน ใช้เฉพาะการตั้งค่าผู้ใช้ของคุณเอง โปรเจกต์เปิดสิ่งนี้ไม่ได้',
    [settingDeny]:
      'รูปแบบเพิ่มเติม (นิพจน์ปกติ) ที่ทำให้เครื่องมือเชลล์ปฏิเสธสคริปต์ นอกเหนือจากการตรวจความปลอดภัยที่มีมาในตัว ใช้เฉพาะการตั้งค่าผู้ใช้ของคุณเอง',
  },
  zh: {
    'Run a shell script': '运行 shell 脚本',
    'Send data to a web server': '向 Web 服务器发送数据',
    'Read from a web server': '从 Web 服务器读取',
    'Open a page in the browser': '在浏览器中打开页面',
    'Run {0}': '运行 {0}',
    [settingHosts]:
      '代理可通过 HTTP 工具向其发送请求的 Web 服务器，例如 localhost:3000 或 *.example.com。为空表示关闭 HTTP 工具。修改服务器上的数据时始终会先询问。只有你自己的用户设置有效，项目无法开启此功能。',
    [settingShell]:
      '允许代理在真实的 shell 中运行脚本，用于管道、&& 和重定向。默认关闭。每个脚本都会展示给你，并需先获得你的批准。只有你自己的用户设置有效，项目无法开启此功能。',
    [settingDeny]:
      '在内置安全检查之外，让 shell 工具拒绝脚本的额外模式（正则表达式）。只有你自己的用户设置有效。',
  },
};
