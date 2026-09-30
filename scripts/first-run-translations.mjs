// First-run surfaces: the Getting Started walkthrough (package.nls) and the
// panel's setup notices (runtime). Same shape as the other *-translations
// tables: English source -> text. Walkthrough descriptions are assembled from a
// sentence plus command links so the command ids live in exactly one place.
const LINK_COMMANDS = [
  ['clawAI.connect'],
  ['clawAI.openChat'],
  ['clawAI.generateCode'],
  ['clawAI.askFile'],
  ['clawAI.rewindConversation', 'clawAI.undoLastEdit'],
  ['clawAI.reviewCode'],
  ['clawAI.managePlugins', 'clawAI.manageScheduledTasks'],
];

function describe(step, index) {
  const links = step.l.map((label, at) => `\n[${label}](command:${LINK_COMMANDS[index][at]})`);
  return `${step.s}${links.join('')}`;
}

function flatten(locale) {
  return [
    locale.title,
    locale.intro,
    ...locale.steps.flatMap((step, index) => [step.t, describe(step, index)]),
    ...locale.runtime,
  ];
}

const en = {
  title: 'Get started with ClawAI',
  intro: 'Connect, ask, change code with your approval, and discover the rest in a few minutes.',
  steps: [
    {
      t: 'Connect your account',
      s: 'Sign in through your browser. Passwords never enter VS Code.',
      l: ['Connect to ClawAI'],
    },
    {
      t: 'Ask your first question',
      s: 'Open the chat and ask about your project. A question never changes a file.',
      l: ['Open chat'],
    },
    {
      t: 'Run an agent task',
      s: 'Describe a change and the agent plans, edits and tests it. You approve every file change before it is written.',
      l: ['Generate code'],
    },
    {
      t: 'Attach files, images and voice',
      s: 'Use the paperclip in the composer to attach a file or image, or the microphone to dictate.',
      l: ['Ask about file'],
    },
    {
      t: 'Review changes and rewind',
      s: 'Review every edit before it lands, undo the last one, or rewind a conversation to an earlier turn.',
      l: ['Rewind conversation', 'Undo last edit'],
    },
    {
      t: 'Commit and open a pull request',
      s: 'Ask the agent to commit your work and open a pull request. You review the exact title and description first.',
      l: ['Review code'],
    },
    {
      t: 'Discover skills, plugins, MCP and scheduled tasks',
      s: 'Add skills and plugins, connect MCP servers, and schedule recurring tasks.',
      l: ['Manage plugins', 'Scheduled tasks'],
    },
  ],
  runtime: [
    'ClawAI cannot reach the backend. Check that it is running, then try again.',
    'Try again',
    'No models are available. Refresh the list once your backend has a model configured.',
    'This workspace is not trusted, so file changes are off. Chat and read-only review still work.',
    'Trust this workspace',
    'Zero data retention is on. Nothing is stored on the server, so uploads, sharing and comparison are off.',
    'Open retention setting',
  ],
};

const locales = {
  ar: {
    title: 'ابدأ مع ClawAI',
    intro: 'اتصل واسأل وعدّل الشيفرة بموافقتك، واكتشف الباقي خلال دقائق.',
    steps: [
      {
        t: 'اربط حسابك',
        s: 'سجّل الدخول عبر المتصفح. لا تدخل كلمات المرور إلى VS Code أبداً.',
        l: ['الاتصال بـ ClawAI'],
      },
      {
        t: 'اطرح سؤالك الأول',
        s: 'افتح المحادثة واسأل عن مشروعك. السؤال لا يغيّر أي ملف أبداً.',
        l: ['فتح المحادثة'],
      },
      {
        t: 'شغّل مهمة للوكيل',
        s: 'صف التغيير فيخطط الوكيل ويعدّل ويختبر. توافق على كل تغيير في الملفات قبل كتابته.',
        l: ['إنشاء شيفرة'],
      },
      {
        t: 'أرفق ملفات وصوراً وصوتاً',
        s: 'استخدم مشبك الورق في المحرر لإرفاق ملف أو صورة، أو الميكروفون للإملاء.',
        l: ['اسأل عن الملف'],
      },
      {
        t: 'راجع التغييرات وارجع للخلف',
        s: 'راجع كل تعديل قبل تطبيقه، وتراجع عن الأخير، أو أرجع المحادثة إلى دور سابق.',
        l: ['إرجاع المحادثة', 'تراجع عن آخر تعديل'],
      },
      {
        t: 'أنشئ التزاماً وافتح طلب سحب',
        s: 'اطلب من الوكيل إنشاء التزام وفتح طلب سحب. تراجع العنوان والوصف بدقة أولاً.',
        l: ['مراجعة الشيفرة'],
      },
      {
        t: 'اكتشف المهارات والإضافات وMCP والمهام المجدولة',
        s: 'أضف مهارات وإضافات، واربط خوادم MCP، وجدول مهام متكررة.',
        l: ['إدارة الإضافات', 'المهام المجدولة'],
      },
    ],
    runtime: [
      'تعذّر على ClawAI الوصول إلى الخادم. تأكد من أنه يعمل ثم حاول مجدداً.',
      'حاول مجدداً',
      'لا توجد نماذج متاحة. حدّث القائمة بعد إعداد نموذج على الخادم.',
      'مساحة العمل هذه غير موثوقة، لذا تغييرات الملفات متوقفة. تبقى المحادثة والمراجعة للقراءة فقط متاحتين.',
      'الوثوق بمساحة العمل هذه',
      'الاحتفاظ الصفري بالبيانات مفعّل. لا يُخزَّن شيء على الخادم، لذا الرفع والمشاركة والمقارنة متوقفة.',
      'فتح إعداد الاحتفاظ',
    ],
  },
  de: {
    title: 'Erste Schritte mit ClawAI',
    intro:
      'Verbinden, fragen, Code mit Ihrer Freigabe ändern und den Rest in wenigen Minuten entdecken.',
    steps: [
      {
        t: 'Konto verbinden',
        s: 'Melden Sie sich über den Browser an. Passwörter gelangen nie in VS Code.',
        l: ['Mit ClawAI verbinden'],
      },
      {
        t: 'Erste Frage stellen',
        s: 'Öffnen Sie den Chat und fragen Sie zu Ihrem Projekt. Eine Frage ändert nie eine Datei.',
        l: ['Chat öffnen'],
      },
      {
        t: 'Agentenaufgabe ausführen',
        s: 'Beschreiben Sie eine Änderung, der Agent plant, bearbeitet und testet sie. Jede Dateiänderung geben Sie vor dem Schreiben frei.',
        l: ['Code generieren'],
      },
      {
        t: 'Dateien, Bilder und Sprache anhängen',
        s: 'Mit der Büroklammer im Eingabefeld hängen Sie eine Datei oder ein Bild an, mit dem Mikrofon diktieren Sie.',
        l: ['Zur Datei fragen'],
      },
      {
        t: 'Änderungen prüfen und zurückspulen',
        s: 'Prüfen Sie jede Bearbeitung vor dem Übernehmen, machen Sie die letzte rückgängig oder spulen Sie eine Unterhaltung zu einem früheren Zug zurück.',
        l: ['Unterhaltung zurückspulen', 'Letzte Bearbeitung rückgängig'],
      },
      {
        t: 'Committen und Pull Request öffnen',
        s: 'Lassen Sie den Agenten Ihre Arbeit committen und einen Pull Request öffnen. Titel und Beschreibung prüfen Sie vorher genau.',
        l: ['Code prüfen'],
      },
      {
        t: 'Skills, Plugins, MCP und geplante Aufgaben entdecken',
        s: 'Fügen Sie Skills und Plugins hinzu, verbinden Sie MCP-Server und planen Sie wiederkehrende Aufgaben.',
        l: ['Plugins verwalten', 'Geplante Aufgaben'],
      },
    ],
    runtime: [
      'ClawAI erreicht das Backend nicht. Prüfen Sie, ob es läuft, und versuchen Sie es erneut.',
      'Erneut versuchen',
      'Keine Modelle verfügbar. Aktualisieren Sie die Liste, sobald Ihr Backend ein Modell eingerichtet hat.',
      'Dieser Arbeitsbereich ist nicht vertrauenswürdig, daher sind Dateiänderungen aus. Chat und schreibgeschützte Prüfung funktionieren weiter.',
      'Diesem Arbeitsbereich vertrauen',
      'Zero Data Retention ist aktiv. Auf dem Server wird nichts gespeichert, daher sind Uploads, Teilen und Vergleichen aus.',
      'Aufbewahrungseinstellung öffnen',
    ],
  },
  es: {
    title: 'Empieza con ClawAI',
    intro:
      'Conecta, pregunta, cambia código con tu aprobación y descubre el resto en pocos minutos.',
    steps: [
      {
        t: 'Conecta tu cuenta',
        s: 'Inicia sesión desde el navegador. Las contraseñas nunca entran en VS Code.',
        l: ['Conectar con ClawAI'],
      },
      {
        t: 'Haz tu primera pregunta',
        s: 'Abre el chat y pregunta sobre tu proyecto. Una pregunta nunca cambia un archivo.',
        l: ['Abrir el chat'],
      },
      {
        t: 'Ejecuta una tarea del agente',
        s: 'Describe un cambio y el agente lo planifica, edita y prueba. Apruebas cada cambio de archivo antes de que se escriba.',
        l: ['Generar código'],
      },
      {
        t: 'Adjunta archivos, imágenes y voz',
        s: 'Usa el clip del compositor para adjuntar un archivo o imagen, o el micrófono para dictar.',
        l: ['Preguntar sobre el archivo'],
      },
      {
        t: 'Revisa cambios y retrocede',
        s: 'Revisa cada edición antes de aplicarla, deshaz la última o retrocede una conversación a un turno anterior.',
        l: ['Retroceder la conversación', 'Deshacer la última edición'],
      },
      {
        t: 'Haz commit y abre una solicitud de extracción',
        s: 'Pide al agente que haga commit y abra una solicitud de extracción. Primero revisas el título y la descripción exactos.',
        l: ['Revisar código'],
      },
      {
        t: 'Descubre habilidades, complementos, MCP y tareas programadas',
        s: 'Añade habilidades y complementos, conecta servidores MCP y programa tareas recurrentes.',
        l: ['Gestionar complementos', 'Tareas programadas'],
      },
    ],
    runtime: [
      'ClawAI no puede conectar con el backend. Comprueba que esté en marcha y vuelve a intentarlo.',
      'Reintentar',
      'No hay modelos disponibles. Actualiza la lista cuando tu backend tenga un modelo configurado.',
      'Este espacio de trabajo no es de confianza, así que los cambios de archivos están desactivados. El chat y la revisión de solo lectura siguen funcionando.',
      'Confiar en este espacio de trabajo',
      'La retención cero de datos está activada. No se guarda nada en el servidor, así que las subidas, compartir y comparar están desactivados.',
      'Abrir el ajuste de retención',
    ],
  },
  fa: {
    title: 'شروع کار با ClawAI',
    intro: 'وصل شوید، بپرسید، با تأیید خودتان کد را تغییر دهید و بقیه را در چند دقیقه کشف کنید.',
    steps: [
      {
        t: 'حساب خود را وصل کنید',
        s: 'از طریق مرورگر وارد شوید. گذرواژه‌ها هرگز وارد VS Code نمی‌شوند.',
        l: ['اتصال به ClawAI'],
      },
      {
        t: 'اولین پرسش خود را بپرسید',
        s: 'گفتگو را باز کنید و درباره پروژه‌تان بپرسید. یک پرسش هرگز فایلی را تغییر نمی‌دهد.',
        l: ['باز کردن گفتگو'],
      },
      {
        t: 'یک وظیفه عامل را اجرا کنید',
        s: 'تغییر را شرح دهید تا عامل آن را برنامه‌ریزی، ویرایش و آزمایش کند. هر تغییر فایل را پیش از نوشتن تأیید می‌کنید.',
        l: ['تولید کد'],
      },
      {
        t: 'فایل، تصویر و صدا پیوست کنید',
        s: 'با گیره کاغذ در جعبه ورودی فایل یا تصویر پیوست کنید، یا با میکروفون دیکته کنید.',
        l: ['پرسش درباره فایل'],
      },
      {
        t: 'تغییرات را بازبینی و به عقب برگردید',
        s: 'هر ویرایش را پیش از اعمال بازبینی کنید، آخرین را واگرد کنید یا گفتگو را به نوبتی قبلی برگردانید.',
        l: ['بازگرداندن گفتگو', 'واگرد آخرین ویرایش'],
      },
      {
        t: 'کامیت کنید و درخواست ادغام باز کنید',
        s: 'از عامل بخواهید کارتان را کامیت و درخواست ادغام باز کند. ابتدا عنوان و توضیح دقیق را بازبینی می‌کنید.',
        l: ['بازبینی کد'],
      },
      {
        t: 'مهارت‌ها، افزونه‌ها، MCP و وظایف زمان‌بندی‌شده را کشف کنید',
        s: 'مهارت و افزونه اضافه کنید، سرورهای MCP را وصل کنید و وظایف تکراری زمان‌بندی کنید.',
        l: ['مدیریت افزونه‌ها', 'وظایف زمان‌بندی‌شده'],
      },
    ],
    runtime: [
      'ClawAI به پشتیبان دسترسی ندارد. مطمئن شوید در حال اجراست و دوباره تلاش کنید.',
      'تلاش دوباره',
      'هیچ مدلی در دسترس نیست. پس از پیکربندی یک مدل در پشتیبان، فهرست را تازه کنید.',
      'این فضای کاری مورد اعتماد نیست، پس تغییر فایل‌ها خاموش است. گفتگو و بازبینی فقط‌خواندنی همچنان کار می‌کنند.',
      'اعتماد به این فضای کاری',
      'عدم نگهداری داده روشن است. چیزی روی سرور ذخیره نمی‌شود، پس بارگذاری، اشتراک‌گذاری و مقایسه خاموش‌اند.',
      'باز کردن تنظیم نگهداری',
    ],
  },
  fr: {
    title: 'Bien démarrer avec ClawAI',
    intro:
      'Connectez-vous, posez une question, modifiez le code avec votre accord et découvrez le reste en quelques minutes.',
    steps: [
      {
        t: 'Connecter votre compte',
        s: 'Connectez-vous depuis le navigateur. Les mots de passe n’entrent jamais dans VS Code.',
        l: ['Se connecter à ClawAI'],
      },
      {
        t: 'Poser votre première question',
        s: 'Ouvrez le chat et interrogez votre projet. Une question ne modifie jamais un fichier.',
        l: ['Ouvrir le chat'],
      },
      {
        t: 'Lancer une tâche d’agent',
        s: 'Décrivez un changement : l’agent le planifie, le modifie et le teste. Vous approuvez chaque modification de fichier avant son écriture.',
        l: ['Générer du code'],
      },
      {
        t: 'Joindre des fichiers, des images et de la voix',
        s: 'Utilisez le trombone du compositeur pour joindre un fichier ou une image, ou le micro pour dicter.',
        l: ['Interroger sur le fichier'],
      },
      {
        t: 'Relire les changements et revenir en arrière',
        s: 'Relisez chaque modification avant qu’elle soit appliquée, annulez la dernière ou revenez à un tour précédent de la conversation.',
        l: ['Revenir en arrière dans la conversation', 'Annuler la dernière modification'],
      },
      {
        t: 'Valider et ouvrir une pull request',
        s: 'Demandez à l’agent de valider votre travail et d’ouvrir une pull request. Vous relisez d’abord le titre et la description exacts.',
        l: ['Relire le code'],
      },
      {
        t: 'Découvrir compétences, plugins, MCP et tâches planifiées',
        s: 'Ajoutez des compétences et des plugins, connectez des serveurs MCP et planifiez des tâches récurrentes.',
        l: ['Gérer les plugins', 'Tâches planifiées'],
      },
    ],
    runtime: [
      'ClawAI ne parvient pas à joindre le backend. Vérifiez qu’il fonctionne, puis réessayez.',
      'Réessayer',
      'Aucun modèle disponible. Actualisez la liste une fois un modèle configuré sur votre backend.',
      'Cet espace de travail n’est pas approuvé : les modifications de fichiers sont désactivées. Le chat et la relecture en lecture seule restent disponibles.',
      'Faire confiance à cet espace de travail',
      'La rétention zéro des données est activée. Rien n’est stocké sur le serveur : envois, partage et comparaison sont désactivés.',
      'Ouvrir le réglage de rétention',
    ],
  },
  hi: {
    title: 'ClawAI के साथ शुरू करें',
    intro: 'जुड़ें, पूछें, अपनी मंज़ूरी से कोड बदलें और बाकी कुछ ही मिनटों में जानें।',
    steps: [
      {
        t: 'अपना खाता जोड़ें',
        s: 'ब्राउज़र से साइन इन करें। पासवर्ड कभी VS Code में दर्ज नहीं होते।',
        l: ['ClawAI से जुड़ें'],
      },
      {
        t: 'अपना पहला सवाल पूछें',
        s: 'चैट खोलें और अपने प्रोजेक्ट के बारे में पूछें। सवाल से कोई फ़ाइल कभी नहीं बदलती।',
        l: ['चैट खोलें'],
      },
      {
        t: 'एक एजेंट कार्य चलाएँ',
        s: 'बदलाव बताएँ; एजेंट उसकी योजना बनाता, संपादित करता और परखता है। हर फ़ाइल बदलाव लिखे जाने से पहले आप मंज़ूर करते हैं।',
        l: ['कोड बनाएँ'],
      },
      {
        t: 'फ़ाइलें, चित्र और आवाज़ संलग्न करें',
        s: 'कंपोज़र में पेपरक्लिप से फ़ाइल या चित्र जोड़ें, या माइक्रोफ़ोन से बोलकर लिखवाएँ।',
        l: ['फ़ाइल के बारे में पूछें'],
      },
      {
        t: 'बदलाव देखें और पीछे लौटें',
        s: 'हर संपादन लागू होने से पहले देखें, आख़िरी को पूर्ववत करें, या बातचीत को पिछले चरण तक लौटाएँ।',
        l: ['बातचीत पीछे लौटाएँ', 'आख़िरी संपादन पूर्ववत करें'],
      },
      {
        t: 'कमिट करें और पुल अनुरोध खोलें',
        s: 'एजेंट से काम कमिट कराएँ और पुल अनुरोध खुलवाएँ। पहले आप सटीक शीर्षक और विवरण देखते हैं।',
        l: ['कोड की समीक्षा करें'],
      },
      {
        t: 'स्किल, प्लगइन, MCP और निर्धारित कार्य खोजें',
        s: 'स्किल और प्लगइन जोड़ें, MCP सर्वर जोड़ें और दोहराए जाने वाले कार्य निर्धारित करें।',
        l: ['प्लगइन प्रबंधित करें', 'निर्धारित कार्य'],
      },
    ],
    runtime: [
      'ClawAI बैकएंड तक नहीं पहुँच पा रहा। जाँचें कि वह चल रहा है, फिर दोबारा कोशिश करें।',
      'फिर कोशिश करें',
      'कोई मॉडल उपलब्ध नहीं है। बैकएंड में मॉडल सेट होने के बाद सूची रीफ़्रेश करें।',
      'यह कार्यक्षेत्र भरोसेमंद नहीं है, इसलिए फ़ाइल बदलाव बंद हैं। चैट और केवल-पढ़ने वाली समीक्षा चालू रहती है।',
      'इस कार्यक्षेत्र पर भरोसा करें',
      'शून्य डेटा प्रतिधारण चालू है। सर्वर पर कुछ संग्रहीत नहीं होता, इसलिए अपलोड, साझा करना और तुलना बंद हैं।',
      'प्रतिधारण सेटिंग खोलें',
    ],
  },
  it: {
    title: 'Inizia con ClawAI',
    intro:
      'Connettiti, fai una domanda, modifica il codice con la tua approvazione e scopri il resto in pochi minuti.',
    steps: [
      {
        t: 'Collega il tuo account',
        s: 'Accedi dal browser. Le password non entrano mai in VS Code.',
        l: ['Connetti a ClawAI'],
      },
      {
        t: 'Fai la tua prima domanda',
        s: 'Apri la chat e chiedi del tuo progetto. Una domanda non modifica mai un file.',
        l: ['Apri la chat'],
      },
      {
        t: 'Esegui un’attività dell’agente',
        s: 'Descrivi una modifica: l’agente la pianifica, la applica e la testa. Approvi ogni modifica ai file prima che venga scritta.',
        l: ['Genera codice'],
      },
      {
        t: 'Allega file, immagini e voce',
        s: 'Usa la graffetta nel compositore per allegare un file o un’immagine, o il microfono per dettare.',
        l: ['Chiedi del file'],
      },
      {
        t: 'Rivedi le modifiche e torna indietro',
        s: 'Rivedi ogni modifica prima che venga applicata, annulla l’ultima o riporta una conversazione a un turno precedente.',
        l: ['Riavvolgi la conversazione', 'Annulla l’ultima modifica'],
      },
      {
        t: 'Fai commit e apri una pull request',
        s: 'Chiedi all’agente di fare commit e aprire una pull request. Prima rivedi titolo e descrizione esatti.',
        l: ['Rivedi il codice'],
      },
      {
        t: 'Scopri competenze, plugin, MCP e attività pianificate',
        s: 'Aggiungi competenze e plugin, collega server MCP e pianifica attività ricorrenti.',
        l: ['Gestisci plugin', 'Attività pianificate'],
      },
    ],
    runtime: [
      'ClawAI non riesce a raggiungere il backend. Verifica che sia in esecuzione, poi riprova.',
      'Riprova',
      'Nessun modello disponibile. Aggiorna l’elenco dopo aver configurato un modello sul backend.',
      'Questo spazio di lavoro non è attendibile, quindi le modifiche ai file sono disattivate. Chat e revisione in sola lettura restano disponibili.',
      'Considera attendibile questo spazio di lavoro',
      'La conservazione zero dei dati è attiva. Nulla viene salvato sul server, quindi caricamenti, condivisione e confronto sono disattivati.',
      'Apri l’impostazione di conservazione',
    ],
  },
  ja: {
    title: 'ClawAI をはじめよう',
    intro: '接続し、質問し、承認したうえでコードを変更し、残りも数分で見つけましょう。',
    steps: [
      {
        t: 'アカウントを接続',
        s: 'ブラウザーでサインインします。パスワードが VS Code に入力されることはありません。',
        l: ['ClawAI に接続'],
      },
      {
        t: '最初の質問をする',
        s: 'チャットを開いてプロジェクトについて質問します。質問でファイルが変更されることはありません。',
        l: ['チャットを開く'],
      },
      {
        t: 'エージェントのタスクを実行',
        s: '変更内容を伝えると、エージェントが計画・編集・テストします。ファイルの変更は書き込まれる前に必ず承認します。',
        l: ['コードを生成'],
      },
      {
        t: 'ファイル、画像、音声を添付',
        s: '入力欄のクリップでファイルや画像を添付し、マイクで音声入力できます。',
        l: ['ファイルについて質問'],
      },
      {
        t: '変更を確認して巻き戻す',
        s: 'すべての編集を反映前に確認し、直前の編集を元に戻し、会話を以前のターンまで巻き戻せます。',
        l: ['会話を巻き戻す', '直前の編集を元に戻す'],
      },
      {
        t: 'コミットしてプルリクエストを開く',
        s: 'エージェントに作業のコミットとプルリクエストの作成を頼みます。タイトルと説明は事前に正確に確認できます。',
        l: ['コードをレビュー'],
      },
      {
        t: 'スキル、プラグイン、MCP、定期タスクを探す',
        s: 'スキルやプラグインを追加し、MCP サーバーを接続し、繰り返しのタスクを予約します。',
        l: ['プラグインを管理', '定期タスク'],
      },
    ],
    runtime: [
      'ClawAI がバックエンドに接続できません。起動しているか確認して、もう一度お試しください。',
      '再試行',
      '利用できるモデルがありません。バックエンドにモデルを設定したら一覧を更新してください。',
      'このワークスペースは信頼されていないため、ファイルの変更はオフです。チャットと読み取り専用のレビューは使えます。',
      'このワークスペースを信頼',
      'データ保持ゼロが有効です。サーバーには何も保存されないため、アップロード、共有、比較はオフです。',
      '保持設定を開く',
    ],
  },
  pt: {
    title: 'Comece com o ClawAI',
    intro:
      'Conecte, pergunte, altere código com a sua aprovação e descubra o resto em poucos minutos.',
    steps: [
      {
        t: 'Conecte a sua conta',
        s: 'Entre pelo navegador. As senhas nunca entram no VS Code.',
        l: ['Conectar ao ClawAI'],
      },
      {
        t: 'Faça a sua primeira pergunta',
        s: 'Abra o chat e pergunte sobre o seu projeto. Uma pergunta nunca altera um arquivo.',
        l: ['Abrir o chat'],
      },
      {
        t: 'Execute uma tarefa do agente',
        s: 'Descreva uma mudança e o agente a planeja, edita e testa. Você aprova cada alteração de arquivo antes de ela ser gravada.',
        l: ['Gerar código'],
      },
      {
        t: 'Anexe arquivos, imagens e voz',
        s: 'Use o clipe no compositor para anexar um arquivo ou imagem, ou o microfone para ditar.',
        l: ['Perguntar sobre o arquivo'],
      },
      {
        t: 'Revise as mudanças e volte atrás',
        s: 'Revise cada edição antes de ela ser aplicada, desfaça a última ou volte uma conversa a um turno anterior.',
        l: ['Voltar a conversa', 'Desfazer a última edição'],
      },
      {
        t: 'Faça commit e abra um pull request',
        s: 'Peça ao agente para fazer commit e abrir um pull request. Você revisa antes o título e a descrição exatos.',
        l: ['Revisar código'],
      },
      {
        t: 'Descubra habilidades, plugins, MCP e tarefas agendadas',
        s: 'Adicione habilidades e plugins, conecte servidores MCP e agende tarefas recorrentes.',
        l: ['Gerenciar plugins', 'Tarefas agendadas'],
      },
    ],
    runtime: [
      'O ClawAI não consegue acessar o backend. Verifique se ele está em execução e tente de novo.',
      'Tentar de novo',
      'Nenhum modelo disponível. Atualize a lista quando o seu backend tiver um modelo configurado.',
      'Este espaço de trabalho não é confiável, então as alterações de arquivos estão desativadas. O chat e a revisão somente leitura continuam disponíveis.',
      'Confiar neste espaço de trabalho',
      'A retenção zero de dados está ativada. Nada é armazenado no servidor, então envios, compartilhamento e comparação estão desativados.',
      'Abrir a configuração de retenção',
    ],
  },
  ru: {
    title: 'Начало работы с ClawAI',
    intro:
      'Подключитесь, задайте вопрос, меняйте код с вашего одобрения и за пару минут узнайте остальное.',
    steps: [
      {
        t: 'Подключите учётную запись',
        s: 'Войдите через браузер. Пароли никогда не попадают в VS Code.',
        l: ['Подключиться к ClawAI'],
      },
      {
        t: 'Задайте первый вопрос',
        s: 'Откройте чат и спросите о своём проекте. Вопрос никогда не меняет файлы.',
        l: ['Открыть чат'],
      },
      {
        t: 'Запустите задачу агента',
        s: 'Опишите изменение, и агент спланирует, изменит и проверит его. Каждое изменение файла вы одобряете до записи.',
        l: ['Сгенерировать код'],
      },
      {
        t: 'Прикрепляйте файлы, изображения и голос',
        s: 'Скрепка в поле ввода прикрепляет файл или изображение, микрофон включает диктовку.',
        l: ['Спросить о файле'],
      },
      {
        t: 'Проверяйте изменения и откатывайтесь',
        s: 'Проверяйте каждую правку до применения, отменяйте последнюю или возвращайте беседу к прежнему шагу.',
        l: ['Откатить беседу', 'Отменить последнюю правку'],
      },
      {
        t: 'Сделайте коммит и откройте pull request',
        s: 'Попросите агента сделать коммит и открыть pull request. Заголовок и описание вы проверяете заранее.',
        l: ['Проверить код'],
      },
      {
        t: 'Навыки, плагины, MCP и задачи по расписанию',
        s: 'Добавляйте навыки и плагины, подключайте серверы MCP и планируйте повторяющиеся задачи.',
        l: ['Управление плагинами', 'Задачи по расписанию'],
      },
    ],
    runtime: [
      'ClawAI не может связаться с бэкендом. Убедитесь, что он запущен, и повторите попытку.',
      'Повторить',
      'Нет доступных моделей. Обновите список, когда на бэкенде будет настроена модель.',
      'Этому рабочему пространству не доверяют, поэтому изменение файлов отключено. Чат и проверка только для чтения работают.',
      'Доверять этому рабочему пространству',
      'Нулевое хранение данных включено. На сервере ничего не сохраняется, поэтому загрузка, общий доступ и сравнение отключены.',
      'Открыть настройку хранения',
    ],
  },
  th: {
    title: 'เริ่มต้นใช้งาน ClawAI',
    intro: 'เชื่อมต่อ ถาม แก้โค้ดตามที่คุณอนุมัติ และค้นพบส่วนที่เหลือภายในไม่กี่นาที',
    steps: [
      {
        t: 'เชื่อมต่อบัญชีของคุณ',
        s: 'ลงชื่อเข้าใช้ผ่านเบราว์เซอร์ รหัสผ่านจะไม่เข้าสู่ VS Code เลย',
        l: ['เชื่อมต่อกับ ClawAI'],
      },
      {
        t: 'ถามคำถามแรกของคุณ',
        s: 'เปิดแชตแล้วถามเกี่ยวกับโปรเจกต์ของคุณ คำถามไม่เปลี่ยนแปลงไฟล์ใดๆ',
        l: ['เปิดแชต'],
      },
      {
        t: 'รันงานของเอเจนต์',
        s: 'อธิบายสิ่งที่ต้องการเปลี่ยน เอเจนต์จะวางแผน แก้ไข และทดสอบ คุณอนุมัติทุกการเปลี่ยนแปลงไฟล์ก่อนบันทึก',
        l: ['สร้างโค้ด'],
      },
      {
        t: 'แนบไฟล์ รูปภาพ และเสียง',
        s: 'ใช้คลิปหนีบในช่องพิมพ์เพื่อแนบไฟล์หรือรูปภาพ หรือใช้ไมโครโฟนเพื่อพูดให้พิมพ์',
        l: ['ถามเกี่ยวกับไฟล์'],
      },
      {
        t: 'ตรวจสอบการเปลี่ยนแปลงและย้อนกลับ',
        s: 'ตรวจทุกการแก้ไขก่อนนำไปใช้ เลิกทำครั้งล่าสุด หรือย้อนบทสนทนากลับไปยังรอบก่อนหน้า',
        l: ['ย้อนบทสนทนา', 'เลิกทำการแก้ไขล่าสุด'],
      },
      {
        t: 'คอมมิตและเปิด pull request',
        s: 'ให้เอเจนต์คอมมิตงานและเปิด pull request คุณจะได้ตรวจชื่อและคำอธิบายจริงก่อน',
        l: ['ตรวจโค้ด'],
      },
      {
        t: 'ค้นพบสกิล ปลั๊กอิน MCP และงานตามกำหนดเวลา',
        s: 'เพิ่มสกิลและปลั๊กอิน เชื่อมต่อเซิร์ฟเวอร์ MCP และตั้งเวลางานที่ทำซ้ำ',
        l: ['จัดการปลั๊กอิน', 'งานตามกำหนดเวลา'],
      },
    ],
    runtime: [
      'ClawAI เชื่อมต่อแบ็กเอนด์ไม่ได้ ตรวจสอบว่าแบ็กเอนด์ทำงานอยู่ แล้วลองอีกครั้ง',
      'ลองอีกครั้ง',
      'ไม่มีโมเดลที่ใช้ได้ รีเฟรชรายการเมื่อแบ็กเอนด์ตั้งค่าโมเดลแล้ว',
      'พื้นที่ทำงานนี้ยังไม่ได้รับความเชื่อถือ การเปลี่ยนแปลงไฟล์จึงปิดอยู่ แชตและการตรวจแบบอ่านอย่างเดียวยังใช้ได้',
      'เชื่อถือพื้นที่ทำงานนี้',
      'เปิดใช้การไม่เก็บข้อมูลเลย จึงไม่มีอะไรถูกเก็บบนเซิร์ฟเวอร์ การอัปโหลด การแชร์ และการเปรียบเทียบจึงปิดอยู่',
      'เปิดการตั้งค่าการเก็บข้อมูล',
    ],
  },
  zh: {
    title: '开始使用 ClawAI',
    intro: '连接、提问、在你批准后修改代码，几分钟内了解其余功能。',
    steps: [
      { t: '连接你的账户', s: '通过浏览器登录。密码绝不会进入 VS Code。', l: ['连接到 ClawAI'] },
      {
        t: '提出第一个问题',
        s: '打开聊天并询问你的项目。提问绝不会更改任何文件。',
        l: ['打开聊天'],
      },
      {
        t: '运行代理任务',
        s: '描述更改，代理会规划、编辑并测试。每项文件更改在写入前都由你批准。',
        l: ['生成代码'],
      },
      {
        t: '附加文件、图片和语音',
        s: '使用输入框中的回形针附加文件或图片，或用麦克风听写。',
        l: ['询问文件'],
      },
      {
        t: '审阅更改并回退',
        s: '在应用前审阅每次编辑，撤销最近一次，或将对话回退到之前的轮次。',
        l: ['回退对话', '撤销上次编辑'],
      },
      {
        t: '提交并创建拉取请求',
        s: '让代理提交你的工作并创建拉取请求。你会先审阅确切的标题和描述。',
        l: ['审查代码'],
      },
      {
        t: '了解技能、插件、MCP 和计划任务',
        s: '添加技能和插件，连接 MCP 服务器，并安排定期任务。',
        l: ['管理插件', '计划任务'],
      },
    ],
    runtime: [
      'ClawAI 无法连接到后端。请确认后端正在运行，然后重试。',
      '重试',
      '没有可用的模型。后端配置好模型后请刷新列表。',
      '此工作区不受信任，因此文件更改已关闭。聊天和只读审查仍可使用。',
      '信任此工作区',
      '零数据保留已开启。服务器上不会存储任何内容，因此上传、分享和对比均已关闭。',
      '打开保留设置',
    ],
  },
};

export const firstRunSource = flatten(en);
const source = firstRunSource;

export const firstRunTranslations = Object.fromEntries(
  Object.entries(locales).map(([code, locale]) => {
    const target = flatten(locale);
    return [code, Object.fromEntries(source.map((message, index) => [message, target[index]]))];
  }),
);
