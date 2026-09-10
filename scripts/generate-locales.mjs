import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { cwd, stdout } from 'node:process';

const root = cwd();
const localeNames = {
  ar: 'العربية',
  de: 'Deutsch',
  es: 'Español',
  fa: 'فارسی',
  fr: 'Français',
  hi: 'हिन्दी',
  it: 'Italiano',
  ja: '日本語',
  pt: 'Português',
  ru: 'Русский',
  th: 'ไทย',
  zh: '简体中文',
};

const sharedTranslations = {
  ar: {
    Connect: 'اتصال',
    'Log Out': 'تسجيل الخروج',
    Chat: 'المحادثة',
    Context: 'السياق',
    History: 'السجل',
    Send: 'إرسال',
    Cancel: 'إلغاء',
    Compare: 'مقارنة',
    Workspace: 'مساحة العمل',
    Selection: 'التحديد',
    None: 'بلا',
    Mode: 'الوضع',
    Route: 'المسار',
    Tokens: 'الرموز',
    Plan: 'الخطة',
    'Open Chat': 'فتح المحادثة',
    'Compare Models': 'مقارنة النماذج',
    'Generate Code': 'إنشاء كود',
    'Generate Tests': 'إنشاء اختبارات',
    'Generate Plan': 'إنشاء خطة',
    'Generate Documentation': 'إنشاء التوثيق',
    'Audit Workspace': 'تدقيق مساحة العمل',
  },
  de: {
    Connect: 'Verbinden',
    'Log Out': 'Abmelden',
    Chat: 'Chat',
    Context: 'Kontext',
    History: 'Verlauf',
    Send: 'Senden',
    Cancel: 'Abbrechen',
    Compare: 'Vergleichen',
    Workspace: 'Arbeitsbereich',
    Selection: 'Auswahl',
    None: 'Keine',
    Mode: 'Modus',
    Route: 'Route',
    Tokens: 'Token',
    Plan: 'Plan',
    'Open Chat': 'Chat öffnen',
    'Compare Models': 'Modelle vergleichen',
    'Generate Code': 'Code erzeugen',
    'Generate Tests': 'Tests erzeugen',
    'Generate Plan': 'Plan erzeugen',
    'Generate Documentation': 'Dokumentation erzeugen',
    'Audit Workspace': 'Arbeitsbereich prüfen',
  },
  es: {
    Connect: 'Conectar',
    'Log Out': 'Cerrar sesión',
    Chat: 'Chat',
    Context: 'Contexto',
    History: 'Historial',
    Send: 'Enviar',
    Cancel: 'Cancelar',
    Compare: 'Comparar',
    Workspace: 'Espacio de trabajo',
    Selection: 'Selección',
    None: 'Ninguno',
    Mode: 'Modo',
    Route: 'Ruta',
    Tokens: 'Tokens',
    Plan: 'Plan',
    'Open Chat': 'Abrir chat',
    'Compare Models': 'Comparar modelos',
    'Generate Code': 'Generar código',
    'Generate Tests': 'Generar pruebas',
    'Generate Plan': 'Generar plan',
    'Generate Documentation': 'Generar documentación',
    'Audit Workspace': 'Auditar espacio de trabajo',
  },
  fa: {
    Connect: 'اتصال',
    'Log Out': 'خروج',
    Chat: 'گفت‌وگو',
    Context: 'زمینه',
    History: 'تاریخچه',
    Send: 'ارسال',
    Cancel: 'لغو',
    Compare: 'مقایسه',
    Workspace: 'فضای کاری',
    Selection: 'انتخاب',
    None: 'هیچ‌کدام',
    Mode: 'حالت',
    Route: 'مسیر',
    Tokens: 'توکن‌ها',
    Plan: 'طرح',
    'Open Chat': 'باز کردن گفت‌وگو',
    'Compare Models': 'مقایسه مدل‌ها',
    'Generate Code': 'تولید کد',
    'Generate Tests': 'تولید آزمون',
    'Generate Plan': 'تولید طرح',
    'Generate Documentation': 'تولید مستندات',
    'Audit Workspace': 'ممیزی فضای کاری',
  },
  fr: {
    Connect: 'Se connecter',
    'Log Out': 'Se déconnecter',
    Chat: 'Discussion',
    Context: 'Contexte',
    History: 'Historique',
    Send: 'Envoyer',
    Cancel: 'Annuler',
    Compare: 'Comparer',
    Workspace: 'Espace de travail',
    Selection: 'Sélection',
    None: 'Aucun',
    Mode: 'Mode',
    Route: 'Itinéraire',
    Tokens: 'Jetons',
    Plan: 'Plan',
    'Open Chat': 'Ouvrir la discussion',
    'Compare Models': 'Comparer les modèles',
    'Generate Code': 'Générer du code',
    'Generate Tests': 'Générer des tests',
    'Generate Plan': 'Générer un plan',
    'Generate Documentation': 'Générer la documentation',
    'Audit Workspace': "Auditer l'espace de travail",
  },
  hi: {
    Connect: 'कनेक्ट करें',
    'Log Out': 'लॉग आउट',
    Chat: 'चैट',
    Context: 'संदर्भ',
    History: 'इतिहास',
    Send: 'भेजें',
    Cancel: 'रद्द करें',
    Compare: 'तुलना',
    Workspace: 'कार्यस्थान',
    Selection: 'चयन',
    None: 'कोई नहीं',
    Mode: 'मोड',
    Route: 'रूट',
    Tokens: 'टोकन',
    Plan: 'योजना',
    'Open Chat': 'चैट खोलें',
    'Compare Models': 'मॉडल की तुलना',
    'Generate Code': 'कोड बनाएँ',
    'Generate Tests': 'टेस्ट बनाएँ',
    'Generate Plan': 'योजना बनाएँ',
    'Generate Documentation': 'दस्तावेज़ बनाएँ',
    'Audit Workspace': 'कार्यस्थान का ऑडिट',
  },
  it: {
    Connect: 'Connetti',
    'Log Out': 'Disconnetti',
    Chat: 'Chat',
    Context: 'Contesto',
    History: 'Cronologia',
    Send: 'Invia',
    Cancel: 'Annulla',
    Compare: 'Confronta',
    Workspace: 'Area di lavoro',
    Selection: 'Selezione',
    None: 'Nessuno',
    Mode: 'Modalità',
    Route: 'Percorso',
    Tokens: 'Token',
    Plan: 'Piano',
    'Open Chat': 'Apri chat',
    'Compare Models': 'Confronta modelli',
    'Generate Code': 'Genera codice',
    'Generate Tests': 'Genera test',
    'Generate Plan': 'Genera piano',
    'Generate Documentation': 'Genera documentazione',
    'Audit Workspace': "Verifica l'area di lavoro",
  },
  ja: {
    Connect: '接続',
    'Log Out': 'ログアウト',
    Chat: 'チャット',
    Context: 'コンテキスト',
    History: '履歴',
    Send: '送信',
    Cancel: 'キャンセル',
    Compare: '比較',
    Workspace: 'ワークスペース',
    Selection: '選択範囲',
    None: 'なし',
    Mode: 'モード',
    Route: 'ルート',
    Tokens: 'トークン',
    Plan: 'プラン',
    'Open Chat': 'チャットを開く',
    'Compare Models': 'モデルを比較',
    'Generate Code': 'コードを生成',
    'Generate Tests': 'テストを生成',
    'Generate Plan': 'プランを生成',
    'Generate Documentation': 'ドキュメントを生成',
    'Audit Workspace': 'ワークスペースを監査',
  },
  pt: {
    Connect: 'Conectar',
    'Log Out': 'Sair',
    Chat: 'Chat',
    Context: 'Contexto',
    History: 'Histórico',
    Send: 'Enviar',
    Cancel: 'Cancelar',
    Compare: 'Comparar',
    Workspace: 'Espaço de trabalho',
    Selection: 'Seleção',
    None: 'Nenhum',
    Mode: 'Modo',
    Route: 'Rota',
    Tokens: 'Tokens',
    Plan: 'Plano',
    'Open Chat': 'Abrir chat',
    'Compare Models': 'Comparar modelos',
    'Generate Code': 'Gerar código',
    'Generate Tests': 'Gerar testes',
    'Generate Plan': 'Gerar plano',
    'Generate Documentation': 'Gerar documentação',
    'Audit Workspace': 'Auditar espaço de trabalho',
  },
  ru: {
    Connect: 'Подключиться',
    'Log Out': 'Выйти',
    Chat: 'Чат',
    Context: 'Контекст',
    History: 'История',
    Send: 'Отправить',
    Cancel: 'Отмена',
    Compare: 'Сравнить',
    Workspace: 'Рабочая область',
    Selection: 'Выделение',
    None: 'Нет',
    Mode: 'Режим',
    Route: 'Маршрут',
    Tokens: 'Токены',
    Plan: 'План',
    'Open Chat': 'Открыть чат',
    'Compare Models': 'Сравнить модели',
    'Generate Code': 'Создать код',
    'Generate Tests': 'Создать тесты',
    'Generate Plan': 'Создать план',
    'Generate Documentation': 'Создать документацию',
    'Audit Workspace': 'Проверить рабочую область',
  },
  th: {
    Connect: 'เชื่อมต่อ',
    'Log Out': 'ออกจากระบบ',
    Chat: 'แชต',
    Context: 'บริบท',
    History: 'ประวัติ',
    Send: 'ส่ง',
    Cancel: 'ยกเลิก',
    Compare: 'เปรียบเทียบ',
    Workspace: 'พื้นที่ทำงาน',
    Selection: 'ส่วนที่เลือก',
    None: 'ไม่มี',
    Mode: 'โหมด',
    Route: 'เส้นทาง',
    Tokens: 'โทเค็น',
    Plan: 'แผน',
    'Open Chat': 'เปิดแชต',
    'Compare Models': 'เปรียบเทียบโมเดล',
    'Generate Code': 'สร้างโค้ด',
    'Generate Tests': 'สร้างการทดสอบ',
    'Generate Plan': 'สร้างแผน',
    'Generate Documentation': 'สร้างเอกสาร',
    'Audit Workspace': 'ตรวจสอบพื้นที่ทำงาน',
  },
  zh: {
    Connect: '连接',
    'Log Out': '退出登录',
    Chat: '聊天',
    Context: '上下文',
    History: '历史',
    Send: '发送',
    Cancel: '取消',
    Compare: '比较',
    Workspace: '工作区',
    Selection: '选区',
    None: '无',
    Mode: '模式',
    Route: '路由',
    Tokens: '令牌',
    Plan: '计划',
    'Open Chat': '打开聊天',
    'Compare Models': '比较模型',
    'Generate Code': '生成代码',
    'Generate Tests': '生成测试',
    'Generate Plan': '生成计划',
    'Generate Documentation': '生成文档',
    'Audit Workspace': '审核工作区',
  },
};

const packageKeyTranslations = {
  'extension.displayName': 'ClawAI Coding Agent',
  'command.askSelection': 'Ask About Selection',
  'command.askFile': 'Ask About File',
  'command.askWorkspace': 'Ask About Workspace',
  'command.judgeResponses': 'Judge Responses',
  'command.fixCode': 'Fix Selected Code',
  'command.reviewCode': 'Review Selected Code',
  'command.initializeWorkspace': 'Initialize .clawai',
  'command.refreshModels': 'Refresh Models',
  'command.selectModel': 'Select Model',
  'command.cancel': 'Cancel Active Request',
  'command.undoLastEdit': 'Undo Last ClawAI Edit',
  'command.showLogs': 'Show Logs',
  'view.container': 'ClawAI',
  'view.chat': 'Chat',
  'view.chatTitle': 'ClawAI Coding Agent',
  'view.model': 'Model & Route',
  'view.context': 'Context',
  'view.history': 'History',
  'config.backendEnvironment': 'Backend',
  'config.backendCustomUrl': 'Custom backend URL',
  'config.frontendEnvironment': 'Frontend',
  'config.frontendCustomUrl': 'Custom frontend URL',
};

const exactTranslations = {
  ar: {
    'Ask About Selection': 'اسأل عن التحديد',
    'Ask About File': 'اسأل عن الملف',
    'Ask About Workspace': 'اسأل عن مساحة العمل',
    'Judge Responses': 'تحكيم الإجابات',
    'Fix Selected Code': 'إصلاح الكود المحدد',
    'Review Selected Code': 'مراجعة الكود المحدد',
    'Initialize .clawai': 'تهيئة ‎.clawai',
    'Refresh Models': 'تحديث النماذج',
    'Select Model': 'اختيار نموذج',
    'Cancel Active Request': 'إلغاء الطلب النشط',
    'Undo Last ClawAI Edit': 'التراجع عن آخر تعديل',
    'Show Logs': 'عرض السجلات',
    'Model & Route': 'النموذج والمسار',
    'Coding Agent': 'وكيل البرمجة',
    Disconnected: 'غير متصل',
    'Active file': 'الملف النشط',
    'Compare + Judge': 'مقارنة وتحكيم',
  },
  de: {
    'Ask About Selection': 'Zur Auswahl fragen',
    'Ask About File': 'Zur Datei fragen',
    'Ask About Workspace': 'Zum Arbeitsbereich fragen',
    'Judge Responses': 'Antworten bewerten',
    'Fix Selected Code': 'Ausgewählten Code reparieren',
    'Review Selected Code': 'Ausgewählten Code prüfen',
    'Initialize .clawai': '.clawai initialisieren',
    'Refresh Models': 'Modelle aktualisieren',
    'Select Model': 'Modell auswählen',
    'Cancel Active Request': 'Aktive Anfrage abbrechen',
    'Undo Last ClawAI Edit': 'Letzte ClawAI-Änderung rückgängig',
    'Show Logs': 'Protokolle anzeigen',
    'Model & Route': 'Modell & Route',
    'Coding Agent': 'Coding-Agent',
    Disconnected: 'Getrennt',
    'Active file': 'Aktive Datei',
    'Compare + Judge': 'Vergleichen + Bewerten',
  },
  es: {
    'Ask About Selection': 'Preguntar sobre la selección',
    'Ask About File': 'Preguntar sobre el archivo',
    'Ask About Workspace': 'Preguntar sobre el espacio de trabajo',
    'Judge Responses': 'Evaluar respuestas',
    'Fix Selected Code': 'Corregir código seleccionado',
    'Review Selected Code': 'Revisar código seleccionado',
    'Initialize .clawai': 'Inicializar .clawai',
    'Refresh Models': 'Actualizar modelos',
    'Select Model': 'Seleccionar modelo',
    'Cancel Active Request': 'Cancelar solicitud activa',
    'Undo Last ClawAI Edit': 'Deshacer última edición de ClawAI',
    'Show Logs': 'Mostrar registros',
    'Model & Route': 'Modelo y ruta',
    'Coding Agent': 'Agente de código',
    Disconnected: 'Desconectado',
    'Active file': 'Archivo activo',
    'Compare + Judge': 'Comparar + evaluar',
  },
  fa: {
    'Ask About Selection': 'پرسش درباره انتخاب',
    'Ask About File': 'پرسش درباره فایل',
    'Ask About Workspace': 'پرسش درباره فضای کاری',
    'Judge Responses': 'داوری پاسخ‌ها',
    'Fix Selected Code': 'اصلاح کد انتخاب‌شده',
    'Review Selected Code': 'بازبینی کد انتخاب‌شده',
    'Initialize .clawai': 'راه‌اندازی ‎.clawai',
    'Refresh Models': 'تازه‌سازی مدل‌ها',
    'Select Model': 'انتخاب مدل',
    'Cancel Active Request': 'لغو درخواست فعال',
    'Undo Last ClawAI Edit': 'واگردانی آخرین ویرایش',
    'Show Logs': 'نمایش گزارش‌ها',
    'Model & Route': 'مدل و مسیر',
    'Coding Agent': 'عامل کدنویسی',
    Disconnected: 'قطع',
    'Active file': 'فایل فعال',
    'Compare + Judge': 'مقایسه + داوری',
  },
  fr: {
    'Ask About Selection': 'Interroger la sélection',
    'Ask About File': 'Interroger le fichier',
    'Ask About Workspace': "Interroger l'espace de travail",
    'Judge Responses': 'Évaluer les réponses',
    'Fix Selected Code': 'Corriger le code sélectionné',
    'Review Selected Code': 'Réviser le code sélectionné',
    'Initialize .clawai': 'Initialiser .clawai',
    'Refresh Models': 'Actualiser les modèles',
    'Select Model': 'Sélectionner un modèle',
    'Cancel Active Request': 'Annuler la requête active',
    'Undo Last ClawAI Edit': 'Annuler la dernière modification ClawAI',
    'Show Logs': 'Afficher les journaux',
    'Model & Route': 'Modèle et itinéraire',
    'Coding Agent': 'Agent de programmation',
    Disconnected: 'Déconnecté',
    'Active file': 'Fichier actif',
    'Compare + Judge': 'Comparer + évaluer',
  },
  hi: {
    'Ask About Selection': 'चयन के बारे में पूछें',
    'Ask About File': 'फ़ाइल के बारे में पूछें',
    'Ask About Workspace': 'कार्यस्थान के बारे में पूछें',
    'Judge Responses': 'जवाबों का मूल्यांकन',
    'Fix Selected Code': 'चुने हुए कोड को ठीक करें',
    'Review Selected Code': 'चुने हुए कोड की समीक्षा',
    'Initialize .clawai': '.clawai आरंभ करें',
    'Refresh Models': 'मॉडल रीफ़्रेश करें',
    'Select Model': 'मॉडल चुनें',
    'Cancel Active Request': 'सक्रिय अनुरोध रद्द करें',
    'Undo Last ClawAI Edit': 'अंतिम ClawAI संपादन वापस लें',
    'Show Logs': 'लॉग दिखाएँ',
    'Model & Route': 'मॉडल और रूट',
    'Coding Agent': 'कोडिंग एजेंट',
    Disconnected: 'डिस्कनेक्ट',
    'Active file': 'सक्रिय फ़ाइल',
    'Compare + Judge': 'तुलना + मूल्यांकन',
  },
  it: {
    'Ask About Selection': 'Chiedi della selezione',
    'Ask About File': 'Chiedi del file',
    'Ask About Workspace': "Chiedi dell'area di lavoro",
    'Judge Responses': 'Valuta risposte',
    'Fix Selected Code': 'Correggi codice selezionato',
    'Review Selected Code': 'Revisiona codice selezionato',
    'Initialize .clawai': 'Inizializza .clawai',
    'Refresh Models': 'Aggiorna modelli',
    'Select Model': 'Seleziona modello',
    'Cancel Active Request': 'Annulla richiesta attiva',
    'Undo Last ClawAI Edit': "Annulla l'ultima modifica ClawAI",
    'Show Logs': 'Mostra log',
    'Model & Route': 'Modello e percorso',
    'Coding Agent': 'Agente di programmazione',
    Disconnected: 'Disconnesso',
    'Active file': 'File attivo',
    'Compare + Judge': 'Confronta + valuta',
  },
  ja: {
    'Ask About Selection': '選択範囲について質問',
    'Ask About File': 'ファイルについて質問',
    'Ask About Workspace': 'ワークスペースについて質問',
    'Judge Responses': '回答を評価',
    'Fix Selected Code': '選択したコードを修正',
    'Review Selected Code': '選択したコードをレビュー',
    'Initialize .clawai': '.clawai を初期化',
    'Refresh Models': 'モデルを更新',
    'Select Model': 'モデルを選択',
    'Cancel Active Request': '実行中の要求をキャンセル',
    'Undo Last ClawAI Edit': '最後の ClawAI 編集を元に戻す',
    'Show Logs': 'ログを表示',
    'Model & Route': 'モデルとルート',
    'Coding Agent': 'コーディングエージェント',
    Disconnected: '未接続',
    'Active file': 'アクティブファイル',
    'Compare + Judge': '比較 + 評価',
  },
  pt: {
    'Ask About Selection': 'Perguntar sobre a seleção',
    'Ask About File': 'Perguntar sobre o arquivo',
    'Ask About Workspace': 'Perguntar sobre o espaço de trabalho',
    'Judge Responses': 'Avaliar respostas',
    'Fix Selected Code': 'Corrigir código selecionado',
    'Review Selected Code': 'Revisar código selecionado',
    'Initialize .clawai': 'Inicializar .clawai',
    'Refresh Models': 'Atualizar modelos',
    'Select Model': 'Selecionar modelo',
    'Cancel Active Request': 'Cancelar solicitação ativa',
    'Undo Last ClawAI Edit': 'Desfazer última edição do ClawAI',
    'Show Logs': 'Mostrar logs',
    'Model & Route': 'Modelo e rota',
    'Coding Agent': 'Agente de código',
    Disconnected: 'Desconectado',
    'Active file': 'Arquivo ativo',
    'Compare + Judge': 'Comparar + avaliar',
  },
  ru: {
    'Ask About Selection': 'Спросить о выделении',
    'Ask About File': 'Спросить о файле',
    'Ask About Workspace': 'Спросить о рабочей области',
    'Judge Responses': 'Оценить ответы',
    'Fix Selected Code': 'Исправить выделенный код',
    'Review Selected Code': 'Проверить выделенный код',
    'Initialize .clawai': 'Инициализировать .clawai',
    'Refresh Models': 'Обновить модели',
    'Select Model': 'Выбрать модель',
    'Cancel Active Request': 'Отменить активный запрос',
    'Undo Last ClawAI Edit': 'Отменить последнее изменение ClawAI',
    'Show Logs': 'Показать журналы',
    'Model & Route': 'Модель и маршрут',
    'Coding Agent': 'Агент программирования',
    Disconnected: 'Отключено',
    'Active file': 'Активный файл',
    'Compare + Judge': 'Сравнить + оценить',
  },
  th: {
    'Ask About Selection': 'ถามเกี่ยวกับส่วนที่เลือก',
    'Ask About File': 'ถามเกี่ยวกับไฟล์',
    'Ask About Workspace': 'ถามเกี่ยวกับพื้นที่ทำงาน',
    'Judge Responses': 'ตัดสินคำตอบ',
    'Fix Selected Code': 'แก้ไขโค้ดที่เลือก',
    'Review Selected Code': 'ตรวจทานโค้ดที่เลือก',
    'Initialize .clawai': 'เริ่มต้น .clawai',
    'Refresh Models': 'รีเฟรชโมเดล',
    'Select Model': 'เลือกโมเดล',
    'Cancel Active Request': 'ยกเลิกคำขอที่ทำงานอยู่',
    'Undo Last ClawAI Edit': 'เลิกทำการแก้ไขล่าสุด',
    'Show Logs': 'แสดงบันทึก',
    'Model & Route': 'โมเดลและเส้นทาง',
    'Coding Agent': 'ตัวแทนเขียนโค้ด',
    Disconnected: 'ไม่ได้เชื่อมต่อ',
    'Active file': 'ไฟล์ที่ใช้งาน',
    'Compare + Judge': 'เปรียบเทียบ + ตัดสิน',
  },
  zh: {
    'Ask About Selection': '询问选区',
    'Ask About File': '询问文件',
    'Ask About Workspace': '询问工作区',
    'Judge Responses': '评判回答',
    'Fix Selected Code': '修复所选代码',
    'Review Selected Code': '审查所选代码',
    'Initialize .clawai': '初始化 .clawai',
    'Refresh Models': '刷新模型',
    'Select Model': '选择模型',
    'Cancel Active Request': '取消活动请求',
    'Undo Last ClawAI Edit': '撤销上次 ClawAI 编辑',
    'Show Logs': '显示日志',
    'Model & Route': '模型和路由',
    'Coding Agent': '编码代理',
    Disconnected: '未连接',
    'Active file': '活动文件',
    'Compare + Judge': '比较 + 评判',
  },
};

const routineApprovalTranslations = {
  ar: {
    'Enable routine workspace access': 'تفعيل الوصول الروتيني إلى مساحة العمل',
    'Allow ClawAI to read non-sensitive workspace files and generate proposed edits here without asking again? Final file changes and commands still require review.':
      'هل تسمح لـ ClawAI بقراءة ملفات مساحة العمل غير الحساسة وإنشاء تعديلات مقترحة هنا دون السؤال مرة أخرى؟ تظل تغييرات الملفات النهائية والأوامر بحاجة إلى المراجعة.',
  },
  de: {
    'Enable routine workspace access': 'Routinemäßigen Arbeitsbereichszugriff aktivieren',
    'Allow ClawAI to read non-sensitive workspace files and generate proposed edits here without asking again? Final file changes and commands still require review.':
      'ClawAI erlauben, nicht vertrauliche Arbeitsbereichsdateien zu lesen und hier Änderungsvorschläge zu erstellen, ohne erneut zu fragen? Endgültige Dateiänderungen und Befehle müssen weiterhin geprüft werden.',
  },
  es: {
    'Enable routine workspace access': 'Activar acceso rutinario al espacio de trabajo',
    'Allow ClawAI to read non-sensitive workspace files and generate proposed edits here without asking again? Final file changes and commands still require review.':
      '¿Permitir que ClawAI lea archivos no confidenciales del espacio de trabajo y genere cambios propuestos aquí sin volver a preguntar? Los cambios finales de archivos y los comandos aún requieren revisión.',
  },
  fa: {
    'Enable routine workspace access': 'فعال‌سازی دسترسی معمول به فضای کاری',
    'Allow ClawAI to read non-sensitive workspace files and generate proposed edits here without asking again? Final file changes and commands still require review.':
      'به ClawAI اجازه می‌دهید فایل‌های غیرحساس فضای کاری را بخواند و بدون پرسش دوباره ویرایش‌های پیشنهادی ایجاد کند؟ تغییرات نهایی فایل‌ها و فرمان‌ها همچنان نیاز به بازبینی دارند.',
  },
  fr: {
    'Enable routine workspace access': 'Activer l’accès courant à l’espace de travail',
    'Allow ClawAI to read non-sensitive workspace files and generate proposed edits here without asking again? Final file changes and commands still require review.':
      'Autoriser ClawAI à lire les fichiers non sensibles de cet espace de travail et à proposer des modifications sans redemander ? Les modifications finales et les commandes doivent toujours être vérifiées.',
  },
  hi: {
    'Enable routine workspace access': 'नियमित कार्यस्थान पहुँच सक्षम करें',
    'Allow ClawAI to read non-sensitive workspace files and generate proposed edits here without asking again? Final file changes and commands still require review.':
      'क्या ClawAI को गैर-संवेदनशील कार्यस्थान फ़ाइलें पढ़ने और दोबारा पूछे बिना प्रस्तावित बदलाव बनाने की अनुमति दें? अंतिम फ़ाइल बदलावों और कमांड की समीक्षा अभी भी आवश्यक है।',
  },
  it: {
    'Enable routine workspace access': 'Abilita l’accesso ordinario all’area di lavoro',
    'Allow ClawAI to read non-sensitive workspace files and generate proposed edits here without asking again? Final file changes and commands still require review.':
      'Consentire a ClawAI di leggere i file non sensibili dell’area di lavoro e generare modifiche proposte senza chiedere di nuovo? Le modifiche finali ai file e i comandi richiedono ancora una revisione.',
  },
  ja: {
    'Enable routine workspace access': '通常のワークスペースアクセスを有効にする',
    'Allow ClawAI to read non-sensitive workspace files and generate proposed edits here without asking again? Final file changes and commands still require review.':
      'ClawAI が機密ではないワークスペースファイルを読み取り、今後確認せずに編集案を生成することを許可しますか？最終的なファイル変更とコマンドは引き続き確認が必要です。',
  },
  pt: {
    'Enable routine workspace access': 'Ativar acesso rotineiro ao espaço de trabalho',
    'Allow ClawAI to read non-sensitive workspace files and generate proposed edits here without asking again? Final file changes and commands still require review.':
      'Permitir que o ClawAI leia arquivos não confidenciais do espaço de trabalho e gere alterações propostas sem perguntar novamente? Alterações finais de arquivos e comandos ainda exigem revisão.',
  },
  ru: {
    'Enable routine workspace access': 'Включить обычный доступ к рабочей области',
    'Allow ClawAI to read non-sensitive workspace files and generate proposed edits here without asking again? Final file changes and commands still require review.':
      'Разрешить ClawAI читать неконфиденциальные файлы рабочей области и предлагать изменения без повторного запроса? Окончательные изменения файлов и команды по-прежнему требуют проверки.',
  },
  th: {
    'Enable routine workspace access': 'เปิดใช้การเข้าถึงพื้นที่ทำงานตามปกติ',
    'Allow ClawAI to read non-sensitive workspace files and generate proposed edits here without asking again? Final file changes and commands still require review.':
      'อนุญาตให้ ClawAI อ่านไฟล์ที่ไม่ละเอียดอ่อนในพื้นที่ทำงานและสร้างการแก้ไขที่เสนอโดยไม่ถามอีกหรือไม่ การเปลี่ยนแปลงไฟล์ขั้นสุดท้ายและคำสั่งยังคงต้องได้รับการตรวจสอบ',
  },
  zh: {
    'Enable routine workspace access': '启用常规工作区访问',
    'Allow ClawAI to read non-sensitive workspace files and generate proposed edits here without asking again? Final file changes and commands still require review.':
      '允许 ClawAI 读取工作区中的非敏感文件并在此生成建议修改，之后不再重复询问？最终文件更改和命令仍需审核。',
  },
};

const releaseTranslations = {
  ar: {
    'Always allow in this workspace': 'السماح دائمًا في مساحة العمل هذه',
    'Repairing model response': 'إصلاح استجابة النموذج',
    'Validating edit plan': 'التحقق من خطة التعديلات',
  },
  de: {
    'Always allow in this workspace': 'In diesem Arbeitsbereich immer zulassen',
    'Repairing model response': 'Modellantwort wird repariert',
    'Validating edit plan': 'Bearbeitungsplan wird geprüft',
  },
  es: {
    'Always allow in this workspace': 'Permitir siempre en este espacio de trabajo',
    'Repairing model response': 'Reparando la respuesta del modelo',
    'Validating edit plan': 'Validando el plan de edición',
  },
  fa: {
    'Always allow in this workspace': 'همیشه در این فضای کاری مجاز باشد',
    'Repairing model response': 'در حال اصلاح پاسخ مدل',
    'Validating edit plan': 'در حال اعتبارسنجی طرح ویرایش',
  },
  fr: {
    'Always allow in this workspace': 'Toujours autoriser dans cet espace de travail',
    'Repairing model response': 'Correction de la réponse du modèle',
    'Validating edit plan': 'Validation du plan de modification',
  },
  hi: {
    'Always allow in this workspace': 'इस कार्यस्थान में हमेशा अनुमति दें',
    'Repairing model response': 'मॉडल प्रतिक्रिया सुधारी जा रही है',
    'Validating edit plan': 'संपादन योजना की पुष्टि की जा रही है',
  },
  it: {
    'Always allow in this workspace': 'Consenti sempre in questa area di lavoro',
    'Repairing model response': 'Correzione della risposta del modello',
    'Validating edit plan': 'Convalida del piano di modifica',
  },
  ja: {
    'Always allow in this workspace': 'このワークスペースでは常に許可',
    'Repairing model response': 'モデル応答を修復中',
    'Validating edit plan': '編集プランを検証中',
  },
  pt: {
    'Always allow in this workspace': 'Sempre permitir neste espaço de trabalho',
    'Repairing model response': 'Corrigindo a resposta do modelo',
    'Validating edit plan': 'Validando o plano de edição',
  },
  ru: {
    'Always allow in this workspace': 'Всегда разрешать в этой рабочей области',
    'Repairing model response': 'Исправление ответа модели',
    'Validating edit plan': 'Проверка плана изменений',
  },
  th: {
    'Always allow in this workspace': 'อนุญาตในพื้นที่ทำงานนี้เสมอ',
    'Repairing model response': 'กำลังแก้ไขคำตอบของโมเดล',
    'Validating edit plan': 'กำลังตรวจสอบแผนการแก้ไข',
  },
  zh: {
    'Always allow in this workspace': '始终允许此工作区',
    'Repairing model response': '正在修复模型响应',
    'Validating edit plan': '正在验证编辑计划',
  },
};

const continuityTranslations = {
  ar: {
    'A workspace file changed during review. Review the updated changes before applying.':
      'تغيّر ملف في مساحة العمل أثناء المراجعة. راجع التغييرات المحدّثة قبل تطبيقها.',
    'Connected to ClawAI.': 'تم الاتصال بـ ClawAI.',
    'ClawAI authorization timed out. Please try again.': 'انتهت مهلة تفويض ClawAI. حاول مرة أخرى.',
    'Full Access skips routine workspace prompts. Final diff and command approvals, Workspace Trust, secret exclusions, path boundaries, and blocked-command rules remain enforced.':
      'يتخطى الوصول الكامل مطالبات مساحة العمل الروتينية. تظل موافقات الفروق النهائية والأوامر، وثقة مساحة العمل، واستثناءات الأسرار، وحدود المسارات، وقواعد الأوامر المحظورة مطبقة.',
    'The reviewed file changes are no longer available.':
      'لم تعد تغييرات الملفات التي تمت مراجعتها متاحة.',
  },
  de: {
    'A workspace file changed during review. Review the updated changes before applying.':
      'Eine Arbeitsbereichsdatei wurde während der Überprüfung geändert. Prüfen Sie die aktualisierten Änderungen vor dem Anwenden.',
    'Connected to ClawAI.': 'Mit ClawAI verbunden.',
    'ClawAI authorization timed out. Please try again.':
      'Die ClawAI-Autorisierung hat das Zeitlimit überschritten. Versuchen Sie es erneut.',
    'Full Access skips routine workspace prompts. Final diff and command approvals, Workspace Trust, secret exclusions, path boundaries, and blocked-command rules remain enforced.':
      'Vollzugriff überspringt routinemäßige Arbeitsbereichsabfragen. Freigaben für den finalen Diff und Befehle, Arbeitsbereichsvertrauen, Geheimnisausschlüsse, Pfadgrenzen und Regeln für blockierte Befehle bleiben aktiv.',
    'The reviewed file changes are no longer available.':
      'Die überprüften Dateiänderungen sind nicht mehr verfügbar.',
  },
  es: {
    'A workspace file changed during review. Review the updated changes before applying.':
      'Un archivo del área de trabajo cambió durante la revisión. Revisa los cambios actualizados antes de aplicarlos.',
    'Connected to ClawAI.': 'Conectado a ClawAI.',
    'ClawAI authorization timed out. Please try again.':
      'La autorización de ClawAI agotó el tiempo de espera. Inténtalo de nuevo.',
    'Full Access skips routine workspace prompts. Final diff and command approvals, Workspace Trust, secret exclusions, path boundaries, and blocked-command rules remain enforced.':
      'El acceso completo omite las solicitudes rutinarias del área de trabajo. Se mantienen las aprobaciones del diff final y de comandos, la confianza del área de trabajo, las exclusiones de secretos, los límites de rutas y las reglas de comandos bloqueados.',
    'The reviewed file changes are no longer available.':
      'Los cambios de archivo revisados ya no están disponibles.',
  },
  fa: {
    'A workspace file changed during review. Review the updated changes before applying.':
      'یک فایل فضای کاری هنگام بازبینی تغییر کرد. پیش از اعمال، تغییرات به‌روزشده را بازبینی کنید.',
    'Connected to ClawAI.': 'به ClawAI متصل شد.',
    'ClawAI authorization timed out. Please try again.':
      'مهلت مجوز ClawAI به پایان رسید. دوباره تلاش کنید.',
    'Full Access skips routine workspace prompts. Final diff and command approvals, Workspace Trust, secret exclusions, path boundaries, and blocked-command rules remain enforced.':
      'دسترسی کامل از پیام‌های معمول فضای کاری عبور می‌کند. تأیید تغییرات نهایی و فرمان‌ها، اعتماد فضای کاری، استثناهای اسرار، مرزهای مسیر و قوانین فرمان‌های مسدودشده همچنان اعمال می‌شوند.',
    'The reviewed file changes are no longer available.':
      'تغییرات فایل بازبینی‌شده دیگر در دسترس نیستند.',
  },
  fr: {
    'A workspace file changed during review. Review the updated changes before applying.':
      'Un fichier de l’espace de travail a changé pendant la vérification. Vérifiez les modifications actualisées avant de les appliquer.',
    'Connected to ClawAI.': 'Connecté à ClawAI.',
    'ClawAI authorization timed out. Please try again.':
      'L’autorisation ClawAI a expiré. Réessayez.',
    'Full Access skips routine workspace prompts. Final diff and command approvals, Workspace Trust, secret exclusions, path boundaries, and blocked-command rules remain enforced.':
      'L’accès complet ignore les demandes courantes liées à l’espace de travail. Les approbations du diff final et des commandes, la confiance de l’espace de travail, les exclusions de secrets, les limites de chemins et les règles de commandes bloquées restent appliquées.',
    'The reviewed file changes are no longer available.':
      'Les modifications de fichiers vérifiées ne sont plus disponibles.',
  },
  hi: {
    'A workspace file changed during review. Review the updated changes before applying.':
      'समीक्षा के दौरान कार्यस्थान की एक फ़ाइल बदल गई। लागू करने से पहले अद्यतन बदलावों की समीक्षा करें।',
    'Connected to ClawAI.': 'ClawAI से कनेक्ट किया गया।',
    'ClawAI authorization timed out. Please try again.':
      'ClawAI प्राधिकरण का समय समाप्त हो गया। फिर से प्रयास करें।',
    'Full Access skips routine workspace prompts. Final diff and command approvals, Workspace Trust, secret exclusions, path boundaries, and blocked-command rules remain enforced.':
      'पूर्ण पहुँच नियमित कार्यस्थान संकेतों को छोड़ देती है। अंतिम डिफ़ और कमांड की स्वीकृति, कार्यस्थान विश्वास, गुप्त जानकारी के बहिष्करण, पथ सीमाएँ और अवरुद्ध कमांड के नियम लागू रहते हैं।',
    'The reviewed file changes are no longer available.':
      'समीक्षा किए गए फ़ाइल बदलाव अब उपलब्ध नहीं हैं।',
  },
  it: {
    'A workspace file changed during review. Review the updated changes before applying.':
      'Un file dell’area di lavoro è cambiato durante la revisione. Rivedi le modifiche aggiornate prima di applicarle.',
    'Connected to ClawAI.': 'Connesso a ClawAI.',
    'ClawAI authorization timed out. Please try again.':
      'L’autorizzazione ClawAI è scaduta. Riprova.',
    'Full Access skips routine workspace prompts. Final diff and command approvals, Workspace Trust, secret exclusions, path boundaries, and blocked-command rules remain enforced.':
      'L’accesso completo ignora le richieste di routine dell’area di lavoro. Restano attive le approvazioni del diff finale e dei comandi, l’attendibilità dell’area di lavoro, le esclusioni dei segreti, i limiti dei percorsi e le regole per i comandi bloccati.',
    'The reviewed file changes are no longer available.':
      'Le modifiche ai file revisionate non sono più disponibili.',
  },
  ja: {
    'A workspace file changed during review. Review the updated changes before applying.':
      'レビュー中にワークスペースのファイルが変更されました。適用する前に更新された変更を確認してください。',
    'Connected to ClawAI.': 'ClawAI に接続しました。',
    'ClawAI authorization timed out. Please try again.':
      'ClawAI の認証がタイムアウトしました。もう一度お試しください。',
    'Full Access skips routine workspace prompts. Final diff and command approvals, Workspace Trust, secret exclusions, path boundaries, and blocked-command rules remain enforced.':
      'フルアクセスでは通常のワークスペース確認を省略します。最終差分とコマンドの承認、ワークスペースの信頼、シークレットの除外、パス境界、禁止コマンドの規則は引き続き適用されます。',
    'The reviewed file changes are no longer available.':
      'レビュー済みのファイル変更は利用できなくなりました。',
  },
  pt: {
    'A workspace file changed during review. Review the updated changes before applying.':
      'Um arquivo do espaço de trabalho mudou durante a revisão. Revise as alterações atualizadas antes de aplicá-las.',
    'Connected to ClawAI.': 'Conectado ao ClawAI.',
    'ClawAI authorization timed out. Please try again.':
      'A autorização do ClawAI expirou. Tente novamente.',
    'Full Access skips routine workspace prompts. Final diff and command approvals, Workspace Trust, secret exclusions, path boundaries, and blocked-command rules remain enforced.':
      'O acesso total ignora solicitações rotineiras do espaço de trabalho. As aprovações do diff final e de comandos, a confiança do espaço de trabalho, as exclusões de segredos, os limites de caminho e as regras de comandos bloqueados continuam em vigor.',
    'The reviewed file changes are no longer available.':
      'As alterações de arquivo revisadas não estão mais disponíveis.',
  },
  ru: {
    'A workspace file changed during review. Review the updated changes before applying.':
      'Файл рабочей области изменился во время проверки. Проверьте обновлённые изменения перед применением.',
    'Connected to ClawAI.': 'Подключено к ClawAI.',
    'ClawAI authorization timed out. Please try again.':
      'Время ожидания авторизации ClawAI истекло. Повторите попытку.',
    'Full Access skips routine workspace prompts. Final diff and command approvals, Workspace Trust, secret exclusions, path boundaries, and blocked-command rules remain enforced.':
      'Полный доступ пропускает обычные запросы к рабочей области. Подтверждение итогового diff и команд, доверие к рабочей области, исключение секретов, границы путей и правила блокировки команд продолжают действовать.',
    'The reviewed file changes are no longer available.':
      'Проверенные изменения файлов больше недоступны.',
  },
  th: {
    'A workspace file changed during review. Review the updated changes before applying.':
      'ไฟล์ในพื้นที่ทำงานเปลี่ยนแปลงระหว่างการตรวจทาน โปรดตรวจทานการเปลี่ยนแปลงล่าสุดก่อนนำไปใช้',
    'Connected to ClawAI.': 'เชื่อมต่อกับ ClawAI แล้ว',
    'ClawAI authorization timed out. Please try again.': 'การอนุญาต ClawAI หมดเวลา โปรดลองอีกครั้ง',
    'Full Access skips routine workspace prompts. Final diff and command approvals, Workspace Trust, secret exclusions, path boundaries, and blocked-command rules remain enforced.':
      'การเข้าถึงแบบเต็มจะข้ามคำขอพื้นที่ทำงานตามปกติ แต่ยังคงบังคับใช้การอนุมัติดิฟสุดท้ายและคำสั่ง ความน่าเชื่อถือของพื้นที่ทำงาน การยกเว้นข้อมูลลับ ขอบเขตพาธ และกฎคำสั่งที่ถูกบล็อก',
    'The reviewed file changes are no longer available.':
      'การเปลี่ยนแปลงไฟล์ที่ตรวจทานแล้วไม่พร้อมใช้งานอีกต่อไป',
  },
  zh: {
    'A workspace file changed during review. Review the updated changes before applying.':
      '工作区文件在审查期间发生了变化。请在应用前审查更新后的更改。',
    'Connected to ClawAI.': '已连接到 ClawAI。',
    'ClawAI authorization timed out. Please try again.': 'ClawAI 授权已超时。请重试。',
    'Full Access skips routine workspace prompts. Final diff and command approvals, Workspace Trust, secret exclusions, path boundaries, and blocked-command rules remain enforced.':
      '完全访问会跳过常规工作区提示，但仍会强制执行最终差异和命令审批、工作区信任、机密排除、路径边界以及命令阻止规则。',
    'The reviewed file changes are no longer available.': '已审查的文件更改不再可用。',
  },
};

const v090Translations = {
  ar: {
    '{0} ({1}/{2})': '{0} ({1}/{2})',
    'A workspace file changed during review. Review the updated changes before applying.':
      'تغيّر ملف في مساحة العمل أثناء المراجعة. راجع التغييرات المحدّثة قبل تطبيقها.',
    'Attach files': 'إرفاق ملفات',
    'Attached file': 'تم إرفاق الملف',
    'Attachment added': 'تمت إضافة المرفق',
    Attachments: 'المرفقات',
    'Attachments must total 10 MiB or less.': 'يجب ألا يتجاوز إجمالي المرفقات 10 ميبيبايت.',
    'ClawAI authorization timed out. Please try again.': 'انتهت مهلة تفويض ClawAI. حاول مرة أخرى.',
    'Connected to ClawAI.': 'تم الاتصال بـ ClawAI.',
    'Ctrl/⌘ + Enter to send · approval follows the selected mode':
      'Ctrl/⌘ + Enter للإرسال · تتبع الموافقة الوضع المحدد',
    'Each attachment must be 5 MiB or smaller.': 'يجب ألا يزيد حجم كل مرفق عن 5 ميبيبايت.',
    'Full Access applies safe file changes automatically and skips routine workspace prompts. Development commands still require approval. Workspace Trust, secret exclusions, path boundaries, and blocked-command rules remain enforced.':
      'يطبّق الوصول الكامل تغييرات الملفات الآمنة تلقائيًا ويتخطى مطالبات مساحة العمل الروتينية. لا تزال أوامر التطوير تتطلب الموافقة. وتظل ثقة مساحة العمل واستثناءات الأسرار وحدود المسارات وقواعد الأوامر المحظورة مطبقة.',
    'The reviewed file changes are no longer available.':
      'لم تعد تغييرات الملفات التي تمت مراجعتها متاحة.',
    'This file could not be attached.': 'تعذر إرفاق هذا الملف.',
    'Uploading attachment': 'جارٍ رفع المرفق',
    'You can attach up to 10 files.': 'يمكنك إرفاق ما يصل إلى 10 ملفات.',
  },
  de: {
    '{0} ({1}/{2})': '{0} ({1}/{2})',
    'A workspace file changed during review. Review the updated changes before applying.':
      'Eine Arbeitsbereichsdatei wurde während der Überprüfung geändert. Prüfen Sie die aktualisierten Änderungen vor dem Anwenden.',
    'Attach files': 'Dateien anhängen',
    'Attached file': 'Datei angehängt',
    'Attachment added': 'Anhang hinzugefügt',
    Attachments: 'Anhänge',
    'Attachments must total 10 MiB or less.':
      'Anhänge dürfen insgesamt höchstens 10 MiB groß sein.',
    'ClawAI authorization timed out. Please try again.':
      'Die ClawAI-Autorisierung hat das Zeitlimit überschritten. Versuchen Sie es erneut.',
    'Connected to ClawAI.': 'Mit ClawAI verbunden.',
    'Ctrl/⌘ + Enter to send · approval follows the selected mode':
      'Ctrl/⌘ + Enter zum Senden · Freigaben folgen dem ausgewählten Modus',
    'Each attachment must be 5 MiB or smaller.': 'Jeder Anhang darf höchstens 5 MiB groß sein.',
    'Full Access applies safe file changes automatically and skips routine workspace prompts. Development commands still require approval. Workspace Trust, secret exclusions, path boundaries, and blocked-command rules remain enforced.':
      'Vollzugriff wendet sichere Dateiänderungen automatisch an und überspringt routinemäßige Arbeitsbereichsabfragen. Entwicklungsbefehle müssen weiterhin freigegeben werden. Arbeitsbereichsvertrauen, Geheimnisausschlüsse, Pfadgrenzen und Regeln für blockierte Befehle bleiben aktiv.',
    'The reviewed file changes are no longer available.':
      'Die überprüften Dateiänderungen sind nicht mehr verfügbar.',
    'This file could not be attached.': 'Diese Datei konnte nicht angehängt werden.',
    'Uploading attachment': 'Anhang wird hochgeladen',
    'You can attach up to 10 files.': 'Sie können bis zu 10 Dateien anhängen.',
  },
  es: {
    '{0} ({1}/{2})': '{0} ({1}/{2})',
    'A workspace file changed during review. Review the updated changes before applying.':
      'Un archivo del área de trabajo cambió durante la revisión. Revisa los cambios actualizados antes de aplicarlos.',
    'Attach files': 'Adjuntar archivos',
    'Attached file': 'Archivo adjuntado',
    'Attachment added': 'Adjunto añadido',
    Attachments: 'Archivos adjuntos',
    'Attachments must total 10 MiB or less.': 'Los archivos adjuntos deben sumar 10 MiB o menos.',
    'ClawAI authorization timed out. Please try again.':
      'La autorización de ClawAI agotó el tiempo de espera. Inténtalo de nuevo.',
    'Connected to ClawAI.': 'Conectado a ClawAI.',
    'Ctrl/⌘ + Enter to send · approval follows the selected mode':
      'Ctrl/⌘ + Enter para enviar · la aprobación sigue el modo seleccionado',
    'Each attachment must be 5 MiB or smaller.':
      'Cada archivo adjunto debe tener un tamaño máximo de 5 MiB.',
    'Full Access applies safe file changes automatically and skips routine workspace prompts. Development commands still require approval. Workspace Trust, secret exclusions, path boundaries, and blocked-command rules remain enforced.':
      'El acceso completo aplica automáticamente los cambios seguros en archivos y omite las solicitudes rutinarias del área de trabajo. Los comandos de desarrollo aún requieren aprobación. La confianza del área de trabajo, las exclusiones de secretos, los límites de rutas y las reglas de comandos bloqueados siguen vigentes.',
    'The reviewed file changes are no longer available.':
      'Los cambios de archivo revisados ya no están disponibles.',
    'This file could not be attached.': 'No se pudo adjuntar este archivo.',
    'Uploading attachment': 'Subiendo archivo adjunto',
    'You can attach up to 10 files.': 'Puedes adjuntar hasta 10 archivos.',
  },
  fa: {
    '{0} ({1}/{2})': '{0} ({1}/{2})',
    'A workspace file changed during review. Review the updated changes before applying.':
      'یک فایل فضای کاری هنگام بازبینی تغییر کرد. پیش از اعمال، تغییرات به‌روزشده را بازبینی کنید.',
    'Attach files': 'پیوست کردن فایل‌ها',
    'Attached file': 'فایل پیوست شد',
    'Attachment added': 'پیوست افزوده شد',
    Attachments: 'پیوست‌ها',
    'Attachments must total 10 MiB or less.': 'حجم کل پیوست‌ها باید ۱۰ مِبی‌بایت یا کمتر باشد.',
    'ClawAI authorization timed out. Please try again.':
      'مهلت مجوز ClawAI به پایان رسید. دوباره تلاش کنید.',
    'Connected to ClawAI.': 'به ClawAI متصل شد.',
    'Ctrl/⌘ + Enter to send · approval follows the selected mode':
      'Ctrl/⌘ + Enter برای ارسال · تأیید از حالت انتخاب‌شده پیروی می‌کند',
    'Each attachment must be 5 MiB or smaller.': 'حجم هر پیوست باید ۵ مِبی‌بایت یا کمتر باشد.',
    'Full Access applies safe file changes automatically and skips routine workspace prompts. Development commands still require approval. Workspace Trust, secret exclusions, path boundaries, and blocked-command rules remain enforced.':
      'دسترسی کامل تغییرات امن فایل را به‌طور خودکار اعمال می‌کند و از پیام‌های معمول فضای کاری می‌گذرد. فرمان‌های توسعه همچنان به تأیید نیاز دارند. اعتماد فضای کاری، استثناهای اسرار، مرزهای مسیر و قوانین فرمان‌های مسدودشده همچنان اعمال می‌شوند.',
    'The reviewed file changes are no longer available.':
      'تغییرات فایل بازبینی‌شده دیگر در دسترس نیستند.',
    'This file could not be attached.': 'این فایل پیوست نشد.',
    'Uploading attachment': 'در حال بارگذاری پیوست',
    'You can attach up to 10 files.': 'می‌توانید حداکثر ۱۰ فایل پیوست کنید.',
  },
  fr: {
    '{0} ({1}/{2})': '{0} ({1}/{2})',
    'A workspace file changed during review. Review the updated changes before applying.':
      'Un fichier de l’espace de travail a changé pendant la vérification. Vérifiez les modifications actualisées avant de les appliquer.',
    'Attach files': 'Joindre des fichiers',
    'Attached file': 'Fichier joint',
    'Attachment added': 'Pièce jointe ajoutée',
    Attachments: 'Pièces jointes',
    'Attachments must total 10 MiB or less.':
      'La taille totale des pièces jointes doit être inférieure ou égale à 10 Mio.',
    'ClawAI authorization timed out. Please try again.':
      'L’autorisation ClawAI a expiré. Réessayez.',
    'Connected to ClawAI.': 'Connecté à ClawAI.',
    'Ctrl/⌘ + Enter to send · approval follows the selected mode':
      'Ctrl/⌘ + Entrée pour envoyer · l’approbation suit le mode sélectionné',
    'Each attachment must be 5 MiB or smaller.':
      'Chaque pièce jointe doit être inférieure ou égale à 5 Mio.',
    'Full Access applies safe file changes automatically and skips routine workspace prompts. Development commands still require approval. Workspace Trust, secret exclusions, path boundaries, and blocked-command rules remain enforced.':
      'L’accès complet applique automatiquement les modifications de fichiers sûres et ignore les demandes courantes liées à l’espace de travail. Les commandes de développement nécessitent toujours une approbation. La confiance de l’espace de travail, les exclusions de secrets, les limites de chemins et les règles de commandes bloquées restent appliquées.',
    'The reviewed file changes are no longer available.':
      'Les modifications de fichiers vérifiées ne sont plus disponibles.',
    'This file could not be attached.': 'Ce fichier n’a pas pu être joint.',
    'Uploading attachment': 'Téléversement de la pièce jointe',
    'You can attach up to 10 files.': 'Vous pouvez joindre jusqu’à 10 fichiers.',
  },
  hi: {
    '{0} ({1}/{2})': '{0} ({1}/{2})',
    'A workspace file changed during review. Review the updated changes before applying.':
      'समीक्षा के दौरान कार्यस्थान की एक फ़ाइल बदल गई। लागू करने से पहले अद्यतन बदलावों की समीक्षा करें।',
    'Attach files': 'फ़ाइलें संलग्न करें',
    'Attached file': 'फ़ाइल संलग्न की गई',
    'Attachment added': 'संलग्नक जोड़ा गया',
    Attachments: 'संलग्नक',
    'Attachments must total 10 MiB or less.': 'संलग्नकों का कुल आकार 10 MiB या कम होना चाहिए।',
    'ClawAI authorization timed out. Please try again.':
      'ClawAI प्राधिकरण का समय समाप्त हो गया। फिर से प्रयास करें।',
    'Connected to ClawAI.': 'ClawAI से कनेक्ट किया गया।',
    'Ctrl/⌘ + Enter to send · approval follows the selected mode':
      'भेजने के लिए Ctrl/⌘ + Enter · स्वीकृति चयनित मोड के अनुसार होगी',
    'Each attachment must be 5 MiB or smaller.': 'प्रत्येक संलग्नक का आकार 5 MiB या कम होना चाहिए।',
    'Full Access applies safe file changes automatically and skips routine workspace prompts. Development commands still require approval. Workspace Trust, secret exclusions, path boundaries, and blocked-command rules remain enforced.':
      'पूर्ण पहुँच सुरक्षित फ़ाइल बदलावों को अपने आप लागू करती है और नियमित कार्यस्थान संकेतों को छोड़ देती है। विकास कमांड के लिए अभी भी स्वीकृति आवश्यक है। कार्यस्थान विश्वास, गुप्त जानकारी के बहिष्करण, पथ सीमाएँ और अवरुद्ध कमांड के नियम लागू रहते हैं।',
    'The reviewed file changes are no longer available.':
      'समीक्षा किए गए फ़ाइल बदलाव अब उपलब्ध नहीं हैं।',
    'This file could not be attached.': 'यह फ़ाइल संलग्न नहीं की जा सकी।',
    'Uploading attachment': 'संलग्नक अपलोड किया जा रहा है',
    'You can attach up to 10 files.': 'आप अधिकतम 10 फ़ाइलें संलग्न कर सकते हैं।',
  },
  it: {
    '{0} ({1}/{2})': '{0} ({1}/{2})',
    'A workspace file changed during review. Review the updated changes before applying.':
      'Un file dell’area di lavoro è cambiato durante la revisione. Rivedi le modifiche aggiornate prima di applicarle.',
    'Attach files': 'Allega file',
    'Attached file': 'File allegato',
    'Attachment added': 'Allegato aggiunto',
    Attachments: 'Allegati',
    'Attachments must total 10 MiB or less.':
      'La dimensione totale degli allegati deve essere pari o inferiore a 10 MiB.',
    'ClawAI authorization timed out. Please try again.':
      'L’autorizzazione ClawAI è scaduta. Riprova.',
    'Connected to ClawAI.': 'Connesso a ClawAI.',
    'Ctrl/⌘ + Enter to send · approval follows the selected mode':
      'Ctrl/⌘ + Invio per inviare · l’approvazione segue la modalità selezionata',
    'Each attachment must be 5 MiB or smaller.':
      'Ogni allegato deve avere una dimensione massima di 5 MiB.',
    'Full Access applies safe file changes automatically and skips routine workspace prompts. Development commands still require approval. Workspace Trust, secret exclusions, path boundaries, and blocked-command rules remain enforced.':
      'L’accesso completo applica automaticamente le modifiche sicure ai file e ignora le richieste di routine dell’area di lavoro. I comandi di sviluppo richiedono ancora l’approvazione. L’attendibilità dell’area di lavoro, le esclusioni dei segreti, i limiti dei percorsi e le regole per i comandi bloccati restano attivi.',
    'The reviewed file changes are no longer available.':
      'Le modifiche ai file revisionate non sono più disponibili.',
    'This file could not be attached.': 'Impossibile allegare questo file.',
    'Uploading attachment': 'Caricamento dell’allegato',
    'You can attach up to 10 files.': 'Puoi allegare fino a 10 file.',
  },
  ja: {
    '{0} ({1}/{2})': '{0}（{1}/{2}）',
    'A workspace file changed during review. Review the updated changes before applying.':
      'レビュー中にワークスペースのファイルが変更されました。適用する前に更新された変更を確認してください。',
    'Attach files': 'ファイルを添付',
    'Attached file': 'ファイルを添付しました',
    'Attachment added': '添付ファイルを追加しました',
    Attachments: '添付ファイル',
    'Attachments must total 10 MiB or less.': '添付ファイルの合計は 10 MiB 以下にしてください。',
    'ClawAI authorization timed out. Please try again.':
      'ClawAI の認証がタイムアウトしました。もう一度お試しください。',
    'Connected to ClawAI.': 'ClawAI に接続しました。',
    'Ctrl/⌘ + Enter to send · approval follows the selected mode':
      'Ctrl/⌘ + Enter で送信 · 承認は選択したモードに従います',
    'Each attachment must be 5 MiB or smaller.': '各添付ファイルは 5 MiB 以下にしてください。',
    'Full Access applies safe file changes automatically and skips routine workspace prompts. Development commands still require approval. Workspace Trust, secret exclusions, path boundaries, and blocked-command rules remain enforced.':
      'フルアクセスでは安全なファイル変更を自動的に適用し、通常のワークスペース確認を省略します。開発コマンドには引き続き承認が必要です。ワークスペースの信頼、シークレットの除外、パス境界、禁止コマンドの規則は引き続き適用されます。',
    'The reviewed file changes are no longer available.':
      'レビュー済みのファイル変更は利用できなくなりました。',
    'This file could not be attached.': 'このファイルを添付できませんでした。',
    'Uploading attachment': '添付ファイルをアップロード中',
    'You can attach up to 10 files.': 'ファイルは最大 10 個まで添付できます。',
  },
  pt: {
    '{0} ({1}/{2})': '{0} ({1}/{2})',
    'A workspace file changed during review. Review the updated changes before applying.':
      'Um arquivo do espaço de trabalho mudou durante a revisão. Revise as alterações atualizadas antes de aplicá-las.',
    'Attach files': 'Anexar arquivos',
    'Attached file': 'Arquivo anexado',
    'Attachment added': 'Anexo adicionado',
    Attachments: 'Anexos',
    'Attachments must total 10 MiB or less.':
      'O tamanho total dos anexos deve ser de 10 MiB ou menos.',
    'ClawAI authorization timed out. Please try again.':
      'A autorização do ClawAI expirou. Tente novamente.',
    'Connected to ClawAI.': 'Conectado ao ClawAI.',
    'Ctrl/⌘ + Enter to send · approval follows the selected mode':
      'Ctrl/⌘ + Enter para enviar · a aprovação segue o modo selecionado',
    'Each attachment must be 5 MiB or smaller.': 'Cada anexo deve ter no máximo 5 MiB.',
    'Full Access applies safe file changes automatically and skips routine workspace prompts. Development commands still require approval. Workspace Trust, secret exclusions, path boundaries, and blocked-command rules remain enforced.':
      'O acesso total aplica automaticamente alterações seguras nos arquivos e ignora solicitações rotineiras do espaço de trabalho. Os comandos de desenvolvimento ainda exigem aprovação. A confiança do espaço de trabalho, as exclusões de segredos, os limites de caminho e as regras de comandos bloqueados continuam em vigor.',
    'The reviewed file changes are no longer available.':
      'As alterações de arquivo revisadas não estão mais disponíveis.',
    'This file could not be attached.': 'Não foi possível anexar este arquivo.',
    'Uploading attachment': 'Enviando anexo',
    'You can attach up to 10 files.': 'Você pode anexar até 10 arquivos.',
  },
  ru: {
    '{0} ({1}/{2})': '{0} ({1}/{2})',
    'A workspace file changed during review. Review the updated changes before applying.':
      'Файл рабочей области изменился во время проверки. Проверьте обновлённые изменения перед применением.',
    'Attach files': 'Прикрепить файлы',
    'Attached file': 'Файл прикреплён',
    'Attachment added': 'Вложение добавлено',
    Attachments: 'Вложения',
    'Attachments must total 10 MiB or less.': 'Общий размер вложений не должен превышать 10 МиБ.',
    'ClawAI authorization timed out. Please try again.':
      'Время ожидания авторизации ClawAI истекло. Повторите попытку.',
    'Connected to ClawAI.': 'Подключено к ClawAI.',
    'Ctrl/⌘ + Enter to send · approval follows the selected mode':
      'Ctrl/⌘ + Enter для отправки · подтверждение зависит от выбранного режима',
    'Each attachment must be 5 MiB or smaller.':
      'Размер каждого вложения не должен превышать 5 МиБ.',
    'Full Access applies safe file changes automatically and skips routine workspace prompts. Development commands still require approval. Workspace Trust, secret exclusions, path boundaries, and blocked-command rules remain enforced.':
      'Полный доступ автоматически применяет безопасные изменения файлов и пропускает обычные запросы к рабочей области. Команды разработки по-прежнему требуют подтверждения. Доверие к рабочей области, исключение секретов, границы путей и правила блокировки команд продолжают действовать.',
    'The reviewed file changes are no longer available.':
      'Проверенные изменения файлов больше недоступны.',
    'This file could not be attached.': 'Не удалось прикрепить этот файл.',
    'Uploading attachment': 'Загрузка вложения',
    'You can attach up to 10 files.': 'Можно прикрепить до 10 файлов.',
  },
  th: {
    '{0} ({1}/{2})': '{0} ({1}/{2})',
    'A workspace file changed during review. Review the updated changes before applying.':
      'ไฟล์ในพื้นที่ทำงานเปลี่ยนแปลงระหว่างการตรวจทาน โปรดตรวจทานการเปลี่ยนแปลงล่าสุดก่อนนำไปใช้',
    'Attach files': 'แนบไฟล์',
    'Attached file': 'แนบไฟล์แล้ว',
    'Attachment added': 'เพิ่มไฟล์แนบแล้ว',
    Attachments: 'ไฟล์แนบ',
    'Attachments must total 10 MiB or less.': 'ไฟล์แนบทั้งหมดต้องมีขนาดไม่เกิน 10 MiB',
    'ClawAI authorization timed out. Please try again.': 'การอนุญาต ClawAI หมดเวลา โปรดลองอีกครั้ง',
    'Connected to ClawAI.': 'เชื่อมต่อกับ ClawAI แล้ว',
    'Ctrl/⌘ + Enter to send · approval follows the selected mode':
      'Ctrl/⌘ + Enter เพื่อส่ง · การอนุมัติเป็นไปตามโหมดที่เลือก',
    'Each attachment must be 5 MiB or smaller.': 'ไฟล์แนบแต่ละไฟล์ต้องมีขนาดไม่เกิน 5 MiB',
    'Full Access applies safe file changes automatically and skips routine workspace prompts. Development commands still require approval. Workspace Trust, secret exclusions, path boundaries, and blocked-command rules remain enforced.':
      'การเข้าถึงแบบเต็มจะใช้การเปลี่ยนแปลงไฟล์ที่ปลอดภัยโดยอัตโนมัติและข้ามคำขอพื้นที่ทำงานตามปกติ คำสั่งสำหรับการพัฒนายังต้องได้รับการอนุมัติ ความน่าเชื่อถือของพื้นที่ทำงาน การยกเว้นข้อมูลลับ ขอบเขตพาธ และกฎคำสั่งที่ถูกบล็อกยังคงมีผล',
    'The reviewed file changes are no longer available.':
      'การเปลี่ยนแปลงไฟล์ที่ตรวจทานแล้วไม่พร้อมใช้งานอีกต่อไป',
    'This file could not be attached.': 'ไม่สามารถแนบไฟล์นี้ได้',
    'Uploading attachment': 'กำลังอัปโหลดไฟล์แนบ',
    'You can attach up to 10 files.': 'คุณสามารถแนบไฟล์ได้สูงสุด 10 ไฟล์',
  },
  zh: {
    '{0} ({1}/{2})': '{0}（{1}/{2}）',
    'A workspace file changed during review. Review the updated changes before applying.':
      '工作区文件在审查期间发生了变化。请在应用前审查更新后的更改。',
    'Attach files': '附加文件',
    'Attached file': '已附加文件',
    'Attachment added': '已添加附件',
    Attachments: '附件',
    'Attachments must total 10 MiB or less.': '附件总大小不得超过 10 MiB。',
    'ClawAI authorization timed out. Please try again.': 'ClawAI 授权已超时。请重试。',
    'Connected to ClawAI.': '已连接到 ClawAI。',
    'Ctrl/⌘ + Enter to send · approval follows the selected mode':
      'Ctrl/⌘ + Enter 发送 · 审批方式取决于所选模式',
    'Each attachment must be 5 MiB or smaller.': '每个附件不得超过 5 MiB。',
    'Full Access applies safe file changes automatically and skips routine workspace prompts. Development commands still require approval. Workspace Trust, secret exclusions, path boundaries, and blocked-command rules remain enforced.':
      '完全访问会自动应用安全的文件更改并跳过常规工作区提示。开发命令仍需审批。工作区信任、机密排除、路径边界以及命令阻止规则仍然有效。',
    'The reviewed file changes are no longer available.': '已审查的文件更改不再可用。',
    'This file could not be attached.': '无法附加此文件。',
    'Uploading attachment': '正在上传附件',
    'You can attach up to 10 files.': '最多可以附加 10 个文件。',
  },
};

function sourceFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : [path];
  });
}

function runtimeMessages() {
  const messages = new Set();
  const expressions = [
    /vscode\.l10n\.t\(\s*(['"])((?:\\.|(?!\1)[\s\S])*?)\1/gu,
    /translated\(\s*(['"])((?:\\.|(?!\1)[\s\S])*?)\1/gu,
  ];
  for (const file of sourceFiles(join(root, 'src')).filter((path) => path.endsWith('.ts'))) {
    const source = readFileSync(file, 'utf8');
    for (const expression of expressions) {
      for (const match of source.matchAll(expression)) {
        if (match[2] !== undefined) {
          messages.add(match[2].replaceAll("\\'", "'").replaceAll('\\"', '"'));
        }
      }
    }
  }
  return [...messages].sort((left, right) => left.localeCompare(right));
}

const cockpitTranslations = {
  ar: {
    '{0} files · {1}': '{0} ملفات · {1}',
    'Agent behavior': 'سلوك الوكيل',
    Automatic: 'تلقائي',
    'Change display language': 'تغيير لغة العرض',
    'Coding automatically': 'البرمجة تلقائياً',
    'Context used': 'السياق المستخدم',
    'Current model': 'النموذج الحالي',
    'Not collected yet': 'لم يُجمع بعد',
    'Planning only': 'التخطيط فقط',
    Routing: 'التوجيه',
    'Selected by you': 'اخترته أنت',
  },
  de: {
    '{0} files · {1}': '{0} Dateien · {1}',
    'Agent behavior': 'Agentenverhalten',
    Automatic: 'Automatisch',
    'Change display language': 'Anzeigesprache ändern',
    'Coding automatically': 'Automatisch programmieren',
    'Context used': 'Verwendeter Kontext',
    'Current model': 'Aktuelles Modell',
    'Not collected yet': 'Noch nicht erfasst',
    'Planning only': 'Nur planen',
    Routing: 'Routing',
    'Selected by you': 'Von dir ausgewählt',
  },
  es: {
    '{0} files · {1}': '{0} archivos · {1}',
    'Agent behavior': 'Comportamiento del agente',
    Automatic: 'Automático',
    'Change display language': 'Cambiar idioma de visualización',
    'Coding automatically': 'Programación automática',
    'Context used': 'Contexto utilizado',
    'Current model': 'Modelo actual',
    'Not collected yet': 'Aún no recopilado',
    'Planning only': 'Solo planificación',
    Routing: 'Enrutamiento',
    'Selected by you': 'Seleccionado por ti',
  },
  fa: {
    '{0} files · {1}': '{0} فایل · {1}',
    'Agent behavior': 'رفتار عامل',
    Automatic: 'خودکار',
    'Change display language': 'تغییر زبان نمایش',
    'Coding automatically': 'کدنویسی خودکار',
    'Context used': 'زمینه استفاده‌شده',
    'Current model': 'مدل فعلی',
    'Not collected yet': 'هنوز جمع‌آوری نشده',
    'Planning only': 'فقط برنامه‌ریزی',
    Routing: 'مسیریابی',
    'Selected by you': 'انتخاب‌شده توسط شما',
  },
  fr: {
    '{0} files · {1}': '{0} fichiers · {1}',
    'Agent behavior': 'Comportement de l’agent',
    Automatic: 'Automatique',
    'Change display language': 'Changer la langue d’affichage',
    'Coding automatically': 'Codage automatique',
    'Context used': 'Contexte utilisé',
    'Current model': 'Modèle actuel',
    'Not collected yet': 'Pas encore collecté',
    'Planning only': 'Planification uniquement',
    Routing: 'Routage',
    'Selected by you': 'Sélectionné par vous',
  },
  hi: {
    '{0} files · {1}': '{0} फ़ाइलें · {1}',
    'Agent behavior': 'एजेंट का व्यवहार',
    Automatic: 'स्वचालित',
    'Change display language': 'प्रदर्शन भाषा बदलें',
    'Coding automatically': 'स्वचालित कोडिंग',
    'Context used': 'उपयोग किया गया संदर्भ',
    'Current model': 'वर्तमान मॉडल',
    'Not collected yet': 'अभी एकत्र नहीं किया गया',
    'Planning only': 'केवल योजना',
    Routing: 'रूटिंग',
    'Selected by you': 'आपके द्वारा चुना गया',
  },
  it: {
    '{0} files · {1}': '{0} file · {1}',
    'Agent behavior': 'Comportamento dell’agente',
    Automatic: 'Automatico',
    'Change display language': 'Cambia lingua di visualizzazione',
    'Coding automatically': 'Programmazione automatica',
    'Context used': 'Contesto utilizzato',
    'Current model': 'Modello attuale',
    'Not collected yet': 'Non ancora raccolto',
    'Planning only': 'Solo pianificazione',
    Routing: 'Instradamento',
    'Selected by you': 'Selezionato da te',
  },
  ja: {
    '{0} files · {1}': '{0} ファイル · {1}',
    'Agent behavior': 'エージェントの動作',
    Automatic: '自動',
    'Change display language': '表示言語を変更',
    'Coding automatically': '自動でコーディング',
    'Context used': '使用したコンテキスト',
    'Current model': '現在のモデル',
    'Not collected yet': 'まだ収集されていません',
    'Planning only': '計画のみ',
    Routing: 'ルーティング',
    'Selected by you': 'あなたが選択',
  },
  pt: {
    '{0} files · {1}': '{0} arquivos · {1}',
    'Agent behavior': 'Comportamento do agente',
    Automatic: 'Automático',
    'Change display language': 'Alterar idioma de exibição',
    'Coding automatically': 'Programação automática',
    'Context used': 'Contexto usado',
    'Current model': 'Modelo atual',
    'Not collected yet': 'Ainda não coletado',
    'Planning only': 'Somente planejamento',
    Routing: 'Roteamento',
    'Selected by you': 'Selecionado por você',
  },
  ru: {
    '{0} files · {1}': '{0} файлов · {1}',
    'Agent behavior': 'Поведение агента',
    Automatic: 'Автоматически',
    'Change display language': 'Изменить язык интерфейса',
    'Coding automatically': 'Автоматическое программирование',
    'Context used': 'Использованный контекст',
    'Current model': 'Текущая модель',
    'Not collected yet': 'Ещё не собрано',
    'Planning only': 'Только планирование',
    Routing: 'Маршрутизация',
    'Selected by you': 'Выбрано вами',
  },
  th: {
    '{0} files · {1}': '{0} ไฟล์ · {1}',
    'Agent behavior': 'การทำงานของเอเจนต์',
    Automatic: 'อัตโนมัติ',
    'Change display language': 'เปลี่ยนภาษาที่แสดง',
    'Coding automatically': 'เขียนโค้ดอัตโนมัติ',
    'Context used': 'บริบทที่ใช้',
    'Current model': 'โมเดลปัจจุบัน',
    'Not collected yet': 'ยังไม่ได้รวบรวม',
    'Planning only': 'วางแผนเท่านั้น',
    Routing: 'การกำหนดเส้นทาง',
    'Selected by you': 'คุณเป็นผู้เลือก',
  },
  zh: {
    '{0} files · {1}': '{0} 个文件 · {1}',
    'Agent behavior': '代理行为',
    Automatic: '自动',
    'Change display language': '更改显示语言',
    'Coding automatically': '自动编码',
    'Context used': '已用上下文',
    'Current model': '当前模型',
    'Not collected yet': '尚未收集',
    'Planning only': '仅规划',
    Routing: '路由',
    'Selected by you': '由你选择',
  },
};

const environmentTranslations = {
  ar: {
    Backend: 'الخلفية',
    Frontend: 'الواجهة',
    Local: 'محلي',
    Cloud: 'سحابي',
    Custom: 'مخصص',
    'App connections': 'اتصالات التطبيق',
    'Custom backend URL': 'رابط خلفية مخصص',
    'Custom frontend URL': 'رابط واجهة مخصص',
    'Save connections': 'حفظ الاتصالات',
    'Use another server': 'استخدام خادم آخر',
    'Use another web app': 'استخدام تطبيق ويب آخر',
    'API, authentication, models, and agent runs': 'واجهة API والمصادقة والنماذج وتشغيل الوكيل',
    'Browser authorization and app links': 'تفويض المتصفح وروابط التطبيق',
    'Choose where the extension sends API requests and opens browser pages.':
      'اختر أين ترسل الإضافة طلبات API وتفتح صفحات المتصفح.',
  },
  de: {
    Backend: 'Backend',
    Frontend: 'Frontend',
    Local: 'Lokal',
    Cloud: 'Cloud',
    Custom: 'Benutzerdefiniert',
    'App connections': 'App-Verbindungen',
    'Custom backend URL': 'Benutzerdefinierte Backend-URL',
    'Custom frontend URL': 'Benutzerdefinierte Frontend-URL',
    'Save connections': 'Verbindungen speichern',
    'Use another server': 'Anderen Server verwenden',
    'Use another web app': 'Andere Web-App verwenden',
    'API, authentication, models, and agent runs':
      'API, Authentifizierung, Modelle und Agentenläufe',
    'Browser authorization and app links': 'Browser-Autorisierung und App-Links',
    'Choose where the extension sends API requests and opens browser pages.':
      'Wähle, wohin die Erweiterung API-Anfragen sendet und Browserseiten öffnet.',
  },
  es: {
    Backend: 'Servidor',
    Frontend: 'Interfaz',
    Local: 'Local',
    Cloud: 'Nube',
    Custom: 'Personalizado',
    'App connections': 'Conexiones de la aplicación',
    'Custom backend URL': 'URL de servidor personalizada',
    'Custom frontend URL': 'URL de interfaz personalizada',
    'Save connections': 'Guardar conexiones',
    'Use another server': 'Usar otro servidor',
    'Use another web app': 'Usar otra aplicación web',
    'API, authentication, models, and agent runs':
      'API, autenticación, modelos y ejecuciones del agente',
    'Browser authorization and app links': 'Autorización del navegador y enlaces de la aplicación',
    'Choose where the extension sends API requests and opens browser pages.':
      'Elige dónde envía la extensión las solicitudes de API y abre páginas del navegador.',
  },
  fa: {
    Backend: 'بک‌اند',
    Frontend: 'فرانت‌اند',
    Local: 'محلی',
    Cloud: 'ابری',
    Custom: 'سفارشی',
    'App connections': 'اتصال‌های برنامه',
    'Custom backend URL': 'نشانی سفارشی بک‌اند',
    'Custom frontend URL': 'نشانی سفارشی فرانت‌اند',
    'Save connections': 'ذخیره اتصال‌ها',
    'Use another server': 'استفاده از سرور دیگر',
    'Use another web app': 'استفاده از وب‌برنامه دیگر',
    'API, authentication, models, and agent runs': 'API، احراز هویت، مدل‌ها و اجرای عامل',
    'Browser authorization and app links': 'مجوز مرورگر و پیوندهای برنامه',
    'Choose where the extension sends API requests and opens browser pages.':
      'محل ارسال درخواست‌های API و باز شدن صفحه‌های مرورگر را انتخاب کنید.',
  },
  fr: {
    Backend: 'Backend',
    Frontend: 'Frontend',
    Local: 'Local',
    Cloud: 'Cloud',
    Custom: 'Personnalisé',
    'App connections': 'Connexions de l’application',
    'Custom backend URL': 'URL backend personnalisée',
    'Custom frontend URL': 'URL frontend personnalisée',
    'Save connections': 'Enregistrer les connexions',
    'Use another server': 'Utiliser un autre serveur',
    'Use another web app': 'Utiliser une autre application web',
    'API, authentication, models, and agent runs':
      'API, authentification, modèles et exécutions de l’agent',
    'Browser authorization and app links': 'Autorisation du navigateur et liens de l’application',
    'Choose where the extension sends API requests and opens browser pages.':
      'Choisissez où l’extension envoie les requêtes API et ouvre les pages du navigateur.',
  },
  hi: {
    Backend: 'बैकएंड',
    Frontend: 'फ्रंटएंड',
    Local: 'स्थानीय',
    Cloud: 'क्लाउड',
    Custom: 'कस्टम',
    'App connections': 'ऐप कनेक्शन',
    'Custom backend URL': 'कस्टम बैकएंड URL',
    'Custom frontend URL': 'कस्टम फ्रंटएंड URL',
    'Save connections': 'कनेक्शन सहेजें',
    'Use another server': 'दूसरा सर्वर उपयोग करें',
    'Use another web app': 'दूसरा वेब ऐप उपयोग करें',
    'API, authentication, models, and agent runs': 'API, प्रमाणीकरण, मॉडल और एजेंट रन',
    'Browser authorization and app links': 'ब्राउज़र प्रमाणीकरण और ऐप लिंक',
    'Choose where the extension sends API requests and opens browser pages.':
      'चुनें कि एक्सटेंशन API अनुरोध कहाँ भेजे और ब्राउज़र पेज कहाँ खोले।',
  },
  it: {
    Backend: 'Backend',
    Frontend: 'Frontend',
    Local: 'Locale',
    Cloud: 'Cloud',
    Custom: 'Personalizzato',
    'App connections': 'Connessioni app',
    'Custom backend URL': 'URL backend personalizzato',
    'Custom frontend URL': 'URL frontend personalizzato',
    'Save connections': 'Salva connessioni',
    'Use another server': 'Usa un altro server',
    'Use another web app': 'Usa un’altra app web',
    'API, authentication, models, and agent runs':
      'API, autenticazione, modelli ed esecuzioni agente',
    'Browser authorization and app links': 'Autorizzazione browser e collegamenti app',
    'Choose where the extension sends API requests and opens browser pages.':
      'Scegli dove l’estensione invia le richieste API e apre le pagine del browser.',
  },
  ja: {
    Backend: 'バックエンド',
    Frontend: 'フロントエンド',
    Local: 'ローカル',
    Cloud: 'クラウド',
    Custom: 'カスタム',
    'App connections': 'アプリ接続',
    'Custom backend URL': 'カスタムバックエンド URL',
    'Custom frontend URL': 'カスタムフロントエンド URL',
    'Save connections': '接続を保存',
    'Use another server': '別のサーバーを使用',
    'Use another web app': '別のウェブアプリを使用',
    'API, authentication, models, and agent runs': 'API、認証、モデル、エージェント実行',
    'Browser authorization and app links': 'ブラウザー認証とアプリリンク',
    'Choose where the extension sends API requests and opens browser pages.':
      '拡張機能が API リクエストを送信し、ブラウザーページを開く場所を選択します。',
  },
  pt: {
    Backend: 'Backend',
    Frontend: 'Frontend',
    Local: 'Local',
    Cloud: 'Nuvem',
    Custom: 'Personalizado',
    'App connections': 'Conexões do aplicativo',
    'Custom backend URL': 'URL de backend personalizada',
    'Custom frontend URL': 'URL de frontend personalizada',
    'Save connections': 'Salvar conexões',
    'Use another server': 'Usar outro servidor',
    'Use another web app': 'Usar outro aplicativo web',
    'API, authentication, models, and agent runs':
      'API, autenticação, modelos e execuções do agente',
    'Browser authorization and app links': 'Autorização do navegador e links do aplicativo',
    'Choose where the extension sends API requests and opens browser pages.':
      'Escolha onde a extensão envia solicitações de API e abre páginas do navegador.',
  },
  ru: {
    Backend: 'Бэкенд',
    Frontend: 'Фронтенд',
    Local: 'Локально',
    Cloud: 'Облако',
    Custom: 'Свой адрес',
    'App connections': 'Подключения приложения',
    'Custom backend URL': 'Свой URL бэкенда',
    'Custom frontend URL': 'Свой URL фронтенда',
    'Save connections': 'Сохранить подключения',
    'Use another server': 'Использовать другой сервер',
    'Use another web app': 'Использовать другое веб-приложение',
    'API, authentication, models, and agent runs': 'API, аутентификация, модели и запуски агента',
    'Browser authorization and app links': 'Авторизация в браузере и ссылки приложения',
    'Choose where the extension sends API requests and opens browser pages.':
      'Выберите, куда расширение отправляет API-запросы и где открывает страницы браузера.',
  },
  th: {
    Backend: 'แบ็กเอนด์',
    Frontend: 'ฟรอนต์เอนด์',
    Local: 'ภายในเครื่อง',
    Cloud: 'คลาวด์',
    Custom: 'กำหนดเอง',
    'App connections': 'การเชื่อมต่อแอป',
    'Custom backend URL': 'URL แบ็กเอนด์ที่กำหนดเอง',
    'Custom frontend URL': 'URL ฟรอนต์เอนด์ที่กำหนดเอง',
    'Save connections': 'บันทึกการเชื่อมต่อ',
    'Use another server': 'ใช้เซิร์ฟเวอร์อื่น',
    'Use another web app': 'ใช้เว็บแอปอื่น',
    'API, authentication, models, and agent runs': 'API การยืนยันตัวตน โมเดล และการทำงานของเอเจนต์',
    'Browser authorization and app links': 'การอนุญาตผ่านเบราว์เซอร์และลิงก์แอป',
    'Choose where the extension sends API requests and opens browser pages.':
      'เลือกตำแหน่งที่ส่วนขยายส่งคำขอ API และเปิดหน้าเบราว์เซอร์',
  },
  zh: {
    Backend: '后端',
    Frontend: '前端',
    Local: '本地',
    Cloud: '云端',
    Custom: '自定义',
    'App connections': '应用连接',
    'Custom backend URL': '自定义后端 URL',
    'Custom frontend URL': '自定义前端 URL',
    'Save connections': '保存连接',
    'Use another server': '使用其他服务器',
    'Use another web app': '使用其他 Web 应用',
    'API, authentication, models, and agent runs': 'API、身份验证、模型和代理运行',
    'Browser authorization and app links': '浏览器授权和应用链接',
    'Choose where the extension sends API requests and opens browser pages.':
      '选择扩展发送 API 请求和打开浏览器页面的位置。',
  },
};

const runtimeV2Translations = {
  ar: {
    'Coding agent activity': 'نشاط وكيل البرمجة',
    '{0} turns · {1} retries': '{0} جولات · {1} إعادات محاولة',
    truncated: 'مقتطع',
    redacted: 'محجوب',
  },
  de: {
    'Coding agent activity': 'Aktivität des Coding-Agenten',
    '{0} turns · {1} retries': '{0} Durchläufe · {1} Wiederholungen',
    truncated: 'gekürzt',
    redacted: 'geschwärzt',
  },
  es: {
    'Coding agent activity': 'Actividad del agente de código',
    '{0} turns · {1} retries': '{0} turnos · {1} reintentos',
    truncated: 'truncado',
    redacted: 'ocultado',
  },
  fa: {
    'Coding agent activity': 'فعالیت عامل برنامه‌نویسی',
    '{0} turns · {1} retries': '{0} نوبت · {1} تلاش مجدد',
    truncated: 'کوتاه‌شده',
    redacted: 'پوشانده‌شده',
  },
  fr: {
    'Coding agent activity': 'Activité de l’agent de programmation',
    '{0} turns · {1} retries': '{0} tours · {1} nouvelles tentatives',
    truncated: 'tronqué',
    redacted: 'masqué',
  },
  hi: {
    'Coding agent activity': 'कोडिंग एजेंट गतिविधि',
    '{0} turns · {1} retries': '{0} चरण · {1} पुनः प्रयास',
    truncated: 'संक्षिप्त',
    redacted: 'छिपाया गया',
  },
  it: {
    'Coding agent activity': 'Attività dell’agente di programmazione',
    '{0} turns · {1} retries': '{0} turni · {1} nuovi tentativi',
    truncated: 'troncato',
    redacted: 'oscurato',
  },
  ja: {
    'Coding agent activity': 'コーディングエージェントのアクティビティ',
    '{0} turns · {1} retries': '{0} ターン · {1} 回再試行',
    truncated: '省略',
    redacted: '秘匿済み',
  },
  pt: {
    'Coding agent activity': 'Atividade do agente de programação',
    '{0} turns · {1} retries': '{0} turnos · {1} novas tentativas',
    truncated: 'truncado',
    redacted: 'ocultado',
  },
  ru: {
    'Coding agent activity': 'Активность агента программирования',
    '{0} turns · {1} retries': '{0} этапов · {1} повторных попыток',
    truncated: 'сокращено',
    redacted: 'скрыто',
  },
  th: {
    'Coding agent activity': 'กิจกรรมของเอเจนต์เขียนโค้ด',
    '{0} turns · {1} retries': '{0} รอบ · ลองใหม่ {1} ครั้ง',
    truncated: 'ตัดทอนแล้ว',
    redacted: 'ปกปิดแล้ว',
  },
  zh: {
    'Coding agent activity': '编程智能体活动',
    '{0} turns · {1} retries': '{0} 轮 · {1} 次重试',
    truncated: '已截断',
    redacted: '已隐藏',
  },
};

const administratorTranslations = {
  ar: {
    'Approve administrator operation': 'الموافقة على عملية المسؤول',
    'ClawAI administrator consent': 'موافقة مسؤول ClawAI',
    'Your operating system will show native administrator consent.':
      'سيعرض نظام التشغيل نافذة الموافقة الأصلية للمسؤول.',
  },
  de: {
    'Approve administrator operation': 'Administratorvorgang genehmigen',
    'ClawAI administrator consent': 'ClawAI-Administratorzustimmung',
    'Your operating system will show native administrator consent.':
      'Ihr Betriebssystem zeigt die native Administratorzustimmung an.',
  },
  es: {
    'Approve administrator operation': 'Aprobar operación de administrador',
    'ClawAI administrator consent': 'Consentimiento de administrador de ClawAI',
    'Your operating system will show native administrator consent.':
      'El sistema operativo mostrará la solicitud nativa de consentimiento del administrador.',
  },
  fa: {
    'Approve administrator operation': 'تأیید عملیات مدیر',
    'ClawAI administrator consent': 'رضایت مدیر ClawAI',
    'Your operating system will show native administrator consent.':
      'سیستم‌عامل شما درخواست بومی رضایت مدیر را نمایش می‌دهد.',
  },
  fr: {
    'Approve administrator operation': 'Approuver l’opération administrateur',
    'ClawAI administrator consent': 'Consentement administrateur ClawAI',
    'Your operating system will show native administrator consent.':
      'Votre système d’exploitation affichera la demande native de consentement administrateur.',
  },
  hi: {
    'Approve administrator operation': 'व्यवस्थापक कार्रवाई स्वीकृत करें',
    'ClawAI administrator consent': 'ClawAI व्यवस्थापक सहमति',
    'Your operating system will show native administrator consent.':
      'आपका ऑपरेटिंग सिस्टम मूल व्यवस्थापक सहमति संवाद दिखाएगा।',
  },
  it: {
    'Approve administrator operation': 'Approva operazione amministratore',
    'ClawAI administrator consent': 'Consenso amministratore ClawAI',
    'Your operating system will show native administrator consent.':
      'Il sistema operativo mostrerà la richiesta nativa di consenso dell’amministratore.',
  },
  ja: {
    'Approve administrator operation': '管理者操作を承認',
    'ClawAI administrator consent': 'ClawAI 管理者の同意',
    'Your operating system will show native administrator consent.':
      'オペレーティングシステムが標準の管理者同意画面を表示します。',
  },
  pt: {
    'Approve administrator operation': 'Aprovar operação de administrador',
    'ClawAI administrator consent': 'Consentimento de administrador do ClawAI',
    'Your operating system will show native administrator consent.':
      'O sistema operacional mostrará a solicitação nativa de consentimento do administrador.',
  },
  ru: {
    'Approve administrator operation': 'Одобрить операцию администратора',
    'ClawAI administrator consent': 'Согласие администратора ClawAI',
    'Your operating system will show native administrator consent.':
      'Операционная система покажет стандартный запрос согласия администратора.',
  },
  th: {
    'Approve administrator operation': 'อนุมัติการดำเนินการของผู้ดูแลระบบ',
    'ClawAI administrator consent': 'ความยินยอมของผู้ดูแลระบบ ClawAI',
    'Your operating system will show native administrator consent.':
      'ระบบปฏิบัติการจะแสดงคำขอความยินยอมของผู้ดูแลระบบแบบเนทีฟ',
  },
  zh: {
    'Approve administrator operation': '批准管理员操作',
    'ClawAI administrator consent': 'ClawAI 管理员授权',
    'Your operating system will show native administrator consent.':
      '操作系统将显示原生管理员授权提示。',
  },
};

const composerTranslations = {
  ar: {
    Agent: 'الوكيل',
    Approval: 'الموافقة',
    Dark: 'داكن',
    Dismiss: 'إخفاء',
    "Don't show again": 'عدم الإظهار مرة أخرى',
    Effort: 'الجهد',
    'Follow VS Code': 'اتباع VS Code',
    Light: 'فاتح',
    Model: 'النموذج',
    'Model list updated': 'تم تحديث قائمة النماذج',
    'More actions': 'إجراءات إضافية',
    'More settings': 'إعدادات إضافية',
    'Output folders': 'مجلدات الإخراج',
    'Refreshing models…': 'جارٍ تحديث النماذج…',
    Run: 'التشغيل',
    'Send message': 'إرسال الرسالة',
    'Send · Ctrl/⌘ + Enter': 'إرسال · Ctrl/⌘ + Enter',
    Speed: 'السرعة',
    Theme: 'المظهر',
    'Web research': 'البحث على الويب',
  },
  de: {
    Agent: 'Agent',
    Approval: 'Genehmigung',
    Dark: 'Dunkel',
    Dismiss: 'Schließen',
    "Don't show again": 'Nicht mehr anzeigen',
    Effort: 'Aufwand',
    'Follow VS Code': 'VS Code folgen',
    Light: 'Hell',
    Model: 'Modell',
    'Model list updated': 'Modellliste aktualisiert',
    'More actions': 'Weitere Aktionen',
    'More settings': 'Weitere Einstellungen',
    'Output folders': 'Ausgabeordner',
    'Refreshing models…': 'Modelle werden aktualisiert…',
    Run: 'Ausführung',
    'Send message': 'Nachricht senden',
    'Send · Ctrl/⌘ + Enter': 'Senden · Ctrl/⌘ + Enter',
    Speed: 'Geschwindigkeit',
    Theme: 'Design',
    'Web research': 'Web-Recherche',
  },
  es: {
    Agent: 'Agente',
    Approval: 'Aprobación',
    Dark: 'Oscuro',
    Dismiss: 'Descartar',
    "Don't show again": 'No mostrar de nuevo',
    Effort: 'Esfuerzo',
    'Follow VS Code': 'Seguir VS Code',
    Light: 'Claro',
    Model: 'Modelo',
    'Model list updated': 'Lista de modelos actualizada',
    'More actions': 'Más acciones',
    'More settings': 'Más ajustes',
    'Output folders': 'Carpetas de salida',
    'Refreshing models…': 'Actualizando modelos…',
    Run: 'Ejecución',
    'Send message': 'Enviar mensaje',
    'Send · Ctrl/⌘ + Enter': 'Enviar · Ctrl/⌘ + Enter',
    Speed: 'Velocidad',
    Theme: 'Tema',
    'Web research': 'Investigación web',
  },
  fa: {
    Agent: 'عامل',
    Approval: 'تأیید',
    Dark: 'تیره',
    Dismiss: 'بستن',
    "Don't show again": 'دیگر نشان نده',
    Effort: 'تلاش',
    'Follow VS Code': 'مطابق VS Code',
    Light: 'روشن',
    Model: 'مدل',
    'Model list updated': 'فهرست مدل‌ها به‌روزرسانی شد',
    'More actions': 'اقدامات بیشتر',
    'More settings': 'تنظیمات بیشتر',
    'Output folders': 'پوشه‌های خروجی',
    'Refreshing models…': 'در حال به‌روزرسانی مدل‌ها…',
    Run: 'اجرا',
    'Send message': 'ارسال پیام',
    'Send · Ctrl/⌘ + Enter': 'ارسال · Ctrl/⌘ + Enter',
    Speed: 'سرعت',
    Theme: 'پوسته',
    'Web research': 'پژوهش وب',
  },
  fr: {
    Agent: 'Agent',
    Approval: 'Approbation',
    Dark: 'Sombre',
    Dismiss: 'Ignorer',
    "Don't show again": 'Ne plus afficher',
    Effort: 'Effort',
    'Follow VS Code': 'Suivre VS Code',
    Light: 'Clair',
    Model: 'Modèle',
    'Model list updated': 'Liste des modèles mise à jour',
    'More actions': 'Plus d’actions',
    'More settings': 'Plus de paramètres',
    'Output folders': 'Dossiers de sortie',
    'Refreshing models…': 'Actualisation des modèles…',
    Run: 'Exécution',
    'Send message': 'Envoyer le message',
    'Send · Ctrl/⌘ + Enter': 'Envoyer · Ctrl/⌘ + Enter',
    Speed: 'Vitesse',
    Theme: 'Thème',
    'Web research': 'Recherche web',
  },
  hi: {
    Agent: 'एजेंट',
    Approval: 'स्वीकृति',
    Dark: 'गहरा',
    Dismiss: 'खारिज करें',
    "Don't show again": 'दोबारा न दिखाएँ',
    Effort: 'प्रयास',
    'Follow VS Code': 'VS Code का अनुसरण करें',
    Light: 'हल्का',
    Model: 'मॉडल',
    'Model list updated': 'मॉडल सूची अपडेट हुई',
    'More actions': 'और क्रियाएँ',
    'More settings': 'और सेटिंग्स',
    'Output folders': 'आउटपुट फ़ोल्डर',
    'Refreshing models…': 'मॉडल ताज़ा हो रहे हैं…',
    Run: 'रन',
    'Send message': 'संदेश भेजें',
    'Send · Ctrl/⌘ + Enter': 'भेजें · Ctrl/⌘ + Enter',
    Speed: 'गति',
    Theme: 'थीम',
    'Web research': 'वेब शोध',
  },
  it: {
    Agent: 'Agente',
    Approval: 'Approvazione',
    Dark: 'Scuro',
    Dismiss: 'Ignora',
    "Don't show again": 'Non mostrare più',
    Effort: 'Impegno',
    'Follow VS Code': 'Segui VS Code',
    Light: 'Chiaro',
    Model: 'Modello',
    'Model list updated': 'Elenco dei modelli aggiornato',
    'More actions': 'Altre azioni',
    'More settings': 'Altre impostazioni',
    'Output folders': 'Cartelle di output',
    'Refreshing models…': 'Aggiornamento dei modelli…',
    Run: 'Esecuzione',
    'Send message': 'Invia messaggio',
    'Send · Ctrl/⌘ + Enter': 'Invia · Ctrl/⌘ + Enter',
    Speed: 'Velocità',
    Theme: 'Tema',
    'Web research': 'Ricerca web',
  },
  ja: {
    Agent: 'エージェント',
    Approval: '承認',
    Dark: 'ダーク',
    Dismiss: '閉じる',
    "Don't show again": '今後表示しない',
    Effort: '労力',
    'Follow VS Code': 'VS Code に従う',
    Light: 'ライト',
    Model: 'モデル',
    'Model list updated': 'モデル一覧を更新しました',
    'More actions': 'その他の操作',
    'More settings': 'その他の設定',
    'Output folders': '出力フォルダー',
    'Refreshing models…': 'モデルを更新しています…',
    Run: '実行',
    'Send message': 'メッセージを送信',
    'Send · Ctrl/⌘ + Enter': '送信 · Ctrl/⌘ + Enter',
    Speed: '速度',
    Theme: 'テーマ',
    'Web research': 'Web調査',
  },
  pt: {
    Agent: 'Agente',
    Approval: 'Aprovação',
    Dark: 'Escuro',
    Dismiss: 'Dispensar',
    "Don't show again": 'Não mostrar novamente',
    Effort: 'Esforço',
    'Follow VS Code': 'Seguir o VS Code',
    Light: 'Claro',
    Model: 'Modelo',
    'Model list updated': 'Lista de modelos atualizada',
    'More actions': 'Mais ações',
    'More settings': 'Mais configurações',
    'Output folders': 'Pastas de saída',
    'Refreshing models…': 'Atualizando modelos…',
    Run: 'Execução',
    'Send message': 'Enviar mensagem',
    'Send · Ctrl/⌘ + Enter': 'Enviar · Ctrl/⌘ + Enter',
    Speed: 'Velocidade',
    Theme: 'Tema',
    'Web research': 'Pesquisa na web',
  },
  ru: {
    Agent: 'Агент',
    Approval: 'Подтверждение',
    Dark: 'Тёмная',
    Dismiss: 'Скрыть',
    "Don't show again": 'Больше не показывать',
    Effort: 'Усилие',
    'Follow VS Code': 'Как в VS Code',
    Light: 'Светлая',
    Model: 'Модель',
    'Model list updated': 'Список моделей обновлён',
    'More actions': 'Другие действия',
    'More settings': 'Дополнительные настройки',
    'Output folders': 'Папки вывода',
    'Refreshing models…': 'Обновление моделей…',
    Run: 'Запуск',
    'Send message': 'Отправить сообщение',
    'Send · Ctrl/⌘ + Enter': 'Отправить · Ctrl/⌘ + Enter',
    Speed: 'Скорость',
    Theme: 'Тема',
    'Web research': 'Веб-поиск',
  },
  th: {
    Agent: 'เอเจนต์',
    Approval: 'การอนุมัติ',
    Dark: 'มืด',
    Dismiss: 'ปิด',
    "Don't show again": 'ไม่ต้องแสดงอีก',
    Effort: 'ความพยายาม',
    'Follow VS Code': 'ตาม VS Code',
    Light: 'สว่าง',
    Model: 'โมเดล',
    'Model list updated': 'อัปเดตรายการโมเดลแล้ว',
    'More actions': 'การกระทำเพิ่มเติม',
    'More settings': 'การตั้งค่าเพิ่มเติม',
    'Output folders': 'โฟลเดอร์ผลลัพธ์',
    'Refreshing models…': 'กำลังรีเฟรชโมเดล…',
    Run: 'การรัน',
    'Send message': 'ส่งข้อความ',
    'Send · Ctrl/⌘ + Enter': 'ส่ง · Ctrl/⌘ + Enter',
    Speed: 'ความเร็ว',
    Theme: 'ธีม',
    'Web research': 'การค้นคว้าบนเว็บ',
  },
  zh: {
    Agent: '智能体',
    Approval: '审批',
    Dark: '深色',
    Dismiss: '关闭',
    "Don't show again": '不再显示',
    Effort: '投入',
    'Follow VS Code': '跟随 VS Code',
    Light: '浅色',
    Model: '模型',
    'Model list updated': '模型列表已更新',
    'More actions': '更多操作',
    'More settings': '更多设置',
    'Output folders': '输出文件夹',
    'Refreshing models…': '正在刷新模型…',
    Run: '运行',
    'Send message': '发送消息',
    'Send · Ctrl/⌘ + Enter': '发送 · Ctrl/⌘ + Enter',
    Speed: '速度',
    Theme: '主题',
    'Web research': '网络检索',
  },
};
const mentionTranslations = {
  ar: {
    '{count} workspace files match': 'تطابق {count} من ملفات مساحة العمل',
    'Workspace files': 'ملفات مساحة العمل',
  },
  de: {
    '{count} workspace files match': '{count} Arbeitsbereichsdateien stimmen überein',
    'Workspace files': 'Arbeitsbereichsdateien',
  },
  es: {
    '{count} workspace files match': '{count} archivos del espacio de trabajo coinciden',
    'Workspace files': 'Archivos del espacio de trabajo',
  },
  fa: {
    '{count} workspace files match': '{count} فایل فضای کاری مطابقت دارد',
    'Workspace files': 'فایل‌های فضای کاری',
  },
  fr: {
    '{count} workspace files match': '{count} fichiers de l’espace de travail correspondent',
    'Workspace files': 'Fichiers de l’espace de travail',
  },
  hi: {
    '{count} workspace files match': '{count} वर्कस्पेस फ़ाइलें मेल खाती हैं',
    'Workspace files': 'वर्कस्पेस फ़ाइलें',
  },
  it: {
    '{count} workspace files match': '{count} file dell’area di lavoro corrispondono',
    'Workspace files': 'File dell’area di lavoro',
  },
  ja: {
    '{count} workspace files match': '{count} 件のワークスペースファイルが一致',
    'Workspace files': 'ワークスペースのファイル',
  },
  pt: {
    '{count} workspace files match': '{count} arquivos do espaço de trabalho correspondem',
    'Workspace files': 'Arquivos do espaço de trabalho',
  },
  ru: {
    '{count} workspace files match': 'Совпадений в рабочей области: {count}',
    'Workspace files': 'Файлы рабочей области',
  },
  th: {
    '{count} workspace files match': 'ไฟล์ในเวิร์กสเปซตรงกัน {count} รายการ',
    'Workspace files': 'ไฟล์ในเวิร์กสเปซ',
  },
  zh: {
    '{count} workspace files match': '{count} 个工作区文件匹配',
    'Workspace files': '工作区文件',
  },
};

const sessionTabTranslations = {
  ar: {
    'No recently closed ClawAI chat to reopen.': 'لا توجد محادثة ClawAI مغلقة مؤخراً لإعادة فتحها.',
    'Reopen Closed Chat': 'إعادة فتح المحادثة المغلقة',
  },
  de: {
    'No recently closed ClawAI chat to reopen.':
      'Kein kürzlich geschlossener ClawAI-Chat zum erneuten Öffnen.',
    'Reopen Closed Chat': 'Geschlossenen Chat erneut öffnen',
  },
  es: {
    'No recently closed ClawAI chat to reopen.':
      'No hay ningún chat de ClawAI cerrado recientemente para reabrir.',
    'Reopen Closed Chat': 'Reabrir chat cerrado',
  },
  fa: {
    'No recently closed ClawAI chat to reopen.':
      'هیچ گفتگوی ClawAI که اخیراً بسته شده باشد برای بازکردن وجود ندارد.',
    'Reopen Closed Chat': 'بازکردن دوباره گفتگوی بسته‌شده',
  },
  fr: {
    'No recently closed ClawAI chat to reopen.':
      'Aucune conversation ClawAI récemment fermée à rouvrir.',
    'Reopen Closed Chat': 'Rouvrir la conversation fermée',
  },
  hi: {
    'No recently closed ClawAI chat to reopen.':
      'फिर से खोलने के लिए हाल में बंद की गई कोई ClawAI चैट नहीं है।',
    'Reopen Closed Chat': 'बंद चैट फिर से खोलें',
  },
  it: {
    'No recently closed ClawAI chat to reopen.':
      'Nessuna chat ClawAI chiusa di recente da riaprire.',
    'Reopen Closed Chat': 'Riapri la chat chiusa',
  },
  ja: {
    'No recently closed ClawAI chat to reopen.':
      '再度開ける、最近閉じた ClawAI チャットはありません。',
    'Reopen Closed Chat': '閉じたチャットを再度開く',
  },
  pt: {
    'No recently closed ClawAI chat to reopen.':
      'Nenhuma conversa do ClawAI fechada recentemente para reabrir.',
    'Reopen Closed Chat': 'Reabrir conversa fechada',
  },
  ru: {
    'No recently closed ClawAI chat to reopen.':
      'Нет недавно закрытых чатов ClawAI для повторного открытия.',
    'Reopen Closed Chat': 'Открыть закрытый чат заново',
  },
  th: {
    'No recently closed ClawAI chat to reopen.': 'ไม่มีแชท ClawAI ที่เพิ่งปิดให้เปิดอีกครั้ง',
    'Reopen Closed Chat': 'เปิดแชทที่ปิดไปอีกครั้ง',
  },
  zh: {
    'No recently closed ClawAI chat to reopen.': '没有最近关闭的 ClawAI 对话可以重新打开。',
    'Reopen Closed Chat': '重新打开已关闭的对话',
  },
};

const threadOrganizationTranslations = {
  ar: {
    'A conversation needs a name.': 'المحادثة تحتاج إلى اسم.',
    'A name you will recognise a week from now.': 'اسم ستتعرف عليه بعد أسبوع من الآن.',
    'Archive Conversation': 'أرشفة المحادثة',
    'Archive conversation': 'أرشفة المحادثة',
    'No conversations are archived.': 'لا توجد محادثات مؤرشفة.',
    'Rename Conversation': 'إعادة تسمية المحادثة',
    'Rename conversation': 'إعادة تسمية المحادثة',
    'Restore Archived Conversation': 'استعادة محادثة مؤرشفة',
    'Restore archived conversation': 'استعادة محادثة مؤرشفة',
    'There are no conversations to archive.': 'لا توجد محادثات لأرشفتها.',
    'There are no conversations to rename.': 'لا توجد محادثات لإعادة تسميتها.',
  },
  de: {
    'A conversation needs a name.': 'Eine Unterhaltung braucht einen Namen.',
    'A name you will recognise a week from now.':
      'Ein Name, den Sie in einer Woche noch wiedererkennen.',
    'Archive Conversation': 'Unterhaltung archivieren',
    'Archive conversation': 'Unterhaltung archivieren',
    'No conversations are archived.': 'Es sind keine Unterhaltungen archiviert.',
    'Rename Conversation': 'Unterhaltung umbenennen',
    'Rename conversation': 'Unterhaltung umbenennen',
    'Restore Archived Conversation': 'Archivierte Unterhaltung wiederherstellen',
    'Restore archived conversation': 'Archivierte Unterhaltung wiederherstellen',
    'There are no conversations to archive.': 'Es gibt keine Unterhaltungen zum Archivieren.',
    'There are no conversations to rename.': 'Es gibt keine Unterhaltungen zum Umbenennen.',
  },
  es: {
    'A conversation needs a name.': 'Una conversación necesita un nombre.',
    'A name you will recognise a week from now.': 'Un nombre que reconocerás dentro de una semana.',
    'Archive Conversation': 'Archivar conversación',
    'Archive conversation': 'Archivar conversación',
    'No conversations are archived.': 'No hay conversaciones archivadas.',
    'Rename Conversation': 'Renombrar conversación',
    'Rename conversation': 'Renombrar conversación',
    'Restore Archived Conversation': 'Restaurar conversación archivada',
    'Restore archived conversation': 'Restaurar conversación archivada',
    'There are no conversations to archive.': 'No hay conversaciones para archivar.',
    'There are no conversations to rename.': 'No hay conversaciones para renombrar.',
  },
  fa: {
    'A conversation needs a name.': 'گفتگو به یک نام نیاز دارد.',
    'A name you will recognise a week from now.': 'نامی که یک هفته بعد هم آن را بشناسید.',
    'Archive Conversation': 'بایگانی گفتگو',
    'Archive conversation': 'بایگانی گفتگو',
    'No conversations are archived.': 'هیچ گفتگویی بایگانی نشده است.',
    'Rename Conversation': 'تغییر نام گفتگو',
    'Rename conversation': 'تغییر نام گفتگو',
    'Restore Archived Conversation': 'بازیابی گفتگوی بایگانی‌شده',
    'Restore archived conversation': 'بازیابی گفتگوی بایگانی‌شده',
    'There are no conversations to archive.': 'گفتگویی برای بایگانی وجود ندارد.',
    'There are no conversations to rename.': 'گفتگویی برای تغییر نام وجود ندارد.',
  },
  fr: {
    'A conversation needs a name.': 'Une conversation a besoin d’un nom.',
    'A name you will recognise a week from now.': 'Un nom que vous reconnaîtrez dans une semaine.',
    'Archive Conversation': 'Archiver la conversation',
    'Archive conversation': 'Archiver la conversation',
    'No conversations are archived.': 'Aucune conversation n’est archivée.',
    'Rename Conversation': 'Renommer la conversation',
    'Rename conversation': 'Renommer la conversation',
    'Restore Archived Conversation': 'Restaurer une conversation archivée',
    'Restore archived conversation': 'Restaurer une conversation archivée',
    'There are no conversations to archive.': 'Aucune conversation à archiver.',
    'There are no conversations to rename.': 'Aucune conversation à renommer.',
  },
  hi: {
    'A conversation needs a name.': 'बातचीत को एक नाम चाहिए।',
    'A name you will recognise a week from now.': 'ऐसा नाम जिसे आप एक सप्ताह बाद भी पहचान लें।',
    'Archive Conversation': 'बातचीत संग्रहित करें',
    'Archive conversation': 'बातचीत संग्रहित करें',
    'No conversations are archived.': 'कोई बातचीत संग्रहित नहीं है।',
    'Rename Conversation': 'बातचीत का नाम बदलें',
    'Rename conversation': 'बातचीत का नाम बदलें',
    'Restore Archived Conversation': 'संग्रहित बातचीत पुनर्स्थापित करें',
    'Restore archived conversation': 'संग्रहित बातचीत पुनर्स्थापित करें',
    'There are no conversations to archive.': 'संग्रहित करने के लिए कोई बातचीत नहीं है।',
    'There are no conversations to rename.': 'नाम बदलने के लिए कोई बातचीत नहीं है।',
  },
  it: {
    'A conversation needs a name.': 'Una conversazione ha bisogno di un nome.',
    'A name you will recognise a week from now.': 'Un nome che riconoscerai tra una settimana.',
    'Archive Conversation': 'Archivia conversazione',
    'Archive conversation': 'Archivia conversazione',
    'No conversations are archived.': 'Nessuna conversazione è archiviata.',
    'Rename Conversation': 'Rinomina conversazione',
    'Rename conversation': 'Rinomina conversazione',
    'Restore Archived Conversation': 'Ripristina conversazione archiviata',
    'Restore archived conversation': 'Ripristina conversazione archiviata',
    'There are no conversations to archive.': 'Non ci sono conversazioni da archiviare.',
    'There are no conversations to rename.': 'Non ci sono conversazioni da rinominare.',
  },
  ja: {
    'A conversation needs a name.': '会話には名前が必要です。',
    'A name you will recognise a week from now.': '1 週間後でも見分けられる名前。',
    'Archive Conversation': '会話をアーカイブ',
    'Archive conversation': '会話をアーカイブ',
    'No conversations are archived.': 'アーカイブされた会話はありません。',
    'Rename Conversation': '会話の名前を変更',
    'Rename conversation': '会話の名前を変更',
    'Restore Archived Conversation': 'アーカイブした会話を復元',
    'Restore archived conversation': 'アーカイブした会話を復元',
    'There are no conversations to archive.': 'アーカイブできる会話はありません。',
    'There are no conversations to rename.': '名前を変更できる会話はありません。',
  },
  pt: {
    'A conversation needs a name.': 'Uma conversa precisa de um nome.',
    'A name you will recognise a week from now.':
      'Um nome que você reconhecerá daqui a uma semana.',
    'Archive Conversation': 'Arquivar conversa',
    'Archive conversation': 'Arquivar conversa',
    'No conversations are archived.': 'Nenhuma conversa está arquivada.',
    'Rename Conversation': 'Renomear conversa',
    'Rename conversation': 'Renomear conversa',
    'Restore Archived Conversation': 'Restaurar conversa arquivada',
    'Restore archived conversation': 'Restaurar conversa arquivada',
    'There are no conversations to archive.': 'Não há conversas para arquivar.',
    'There are no conversations to rename.': 'Não há conversas para renomear.',
  },
  ru: {
    'A conversation needs a name.': 'Беседе нужно имя.',
    'A name you will recognise a week from now.': 'Имя, которое вы узнаете и через неделю.',
    'Archive Conversation': 'Архивировать беседу',
    'Archive conversation': 'Архивировать беседу',
    'No conversations are archived.': 'Архивных бесед нет.',
    'Rename Conversation': 'Переименовать беседу',
    'Rename conversation': 'Переименовать беседу',
    'Restore Archived Conversation': 'Восстановить архивную беседу',
    'Restore archived conversation': 'Восстановить архивную беседу',
    'There are no conversations to archive.': 'Нет бесед для архивирования.',
    'There are no conversations to rename.': 'Нет бесед для переименования.',
  },
  th: {
    'A conversation needs a name.': 'การสนทนาต้องมีชื่อ',
    'A name you will recognise a week from now.': 'ชื่อที่คุณจะจำได้ในอีกหนึ่งสัปดาห์',
    'Archive Conversation': 'เก็บการสนทนาเข้าคลัง',
    'Archive conversation': 'เก็บการสนทนาเข้าคลัง',
    'No conversations are archived.': 'ไม่มีการสนทนาที่ถูกเก็บไว้',
    'Rename Conversation': 'เปลี่ยนชื่อการสนทนา',
    'Rename conversation': 'เปลี่ยนชื่อการสนทนา',
    'Restore Archived Conversation': 'กู้คืนการสนทนาที่เก็บไว้',
    'Restore archived conversation': 'กู้คืนการสนทนาที่เก็บไว้',
    'There are no conversations to archive.': 'ไม่มีการสนทนาให้เก็บเข้าคลัง',
    'There are no conversations to rename.': 'ไม่มีการสนทนาให้เปลี่ยนชื่อ',
  },
  zh: {
    'A conversation needs a name.': '对话需要一个名称。',
    'A name you will recognise a week from now.': '一周后你仍能认出的名称。',
    'Archive Conversation': '归档对话',
    'Archive conversation': '归档对话',
    'No conversations are archived.': '没有已归档的对话。',
    'Rename Conversation': '重命名对话',
    'Rename conversation': '重命名对话',
    'Restore Archived Conversation': '恢复已归档的对话',
    'Restore archived conversation': '恢复已归档的对话',
    'There are no conversations to archive.': '没有可归档的对话。',
    'There are no conversations to rename.': '没有可重命名的对话。',
  },
};

const focusViewTranslations = {
  ar: {
    'Focus view': 'وضع التركيز',
    'Show the whole cockpit, or only the conversation and composer.':
      'إظهار الواجهة كاملة، أو المحادثة ومربع الكتابة فقط.',
    'Toggle Focus View': 'تبديل وضع التركيز',
  },
  de: {
    'Focus view': 'Fokusansicht',
    'Show the whole cockpit, or only the conversation and composer.':
      'Das gesamte Cockpit anzeigen oder nur Unterhaltung und Eingabefeld.',
    'Toggle Focus View': 'Fokusansicht umschalten',
  },
  es: {
    'Focus view': 'Vista de enfoque',
    'Show the whole cockpit, or only the conversation and composer.':
      'Mostrar todo el panel, o solo la conversación y el editor.',
    'Toggle Focus View': 'Alternar vista de enfoque',
  },
  fa: {
    'Focus view': 'نمای تمرکز',
    'Show the whole cockpit, or only the conversation and composer.':
      'نمایش کل کابین، یا فقط گفتگو و کادر نوشتن.',
    'Toggle Focus View': 'تغییر نمای تمرکز',
  },
  fr: {
    'Focus view': 'Vue focalisée',
    'Show the whole cockpit, or only the conversation and composer.':
      'Afficher tout le cockpit, ou seulement la conversation et le champ de saisie.',
    'Toggle Focus View': 'Basculer la vue focalisée',
  },
  hi: {
    'Focus view': 'फ़ोकस दृश्य',
    'Show the whole cockpit, or only the conversation and composer.':
      'पूरा कॉकपिट दिखाएँ, या केवल बातचीत और लेखन बॉक्स।',
    'Toggle Focus View': 'फ़ोकस दृश्य टॉगल करें',
  },
  it: {
    'Focus view': 'Vista focus',
    'Show the whole cockpit, or only the conversation and composer.':
      'Mostra tutto il pannello, o solo la conversazione e il campo di scrittura.',
    'Toggle Focus View': 'Attiva/disattiva vista focus',
  },
  ja: {
    'Focus view': 'フォーカス表示',
    'Show the whole cockpit, or only the conversation and composer.':
      'すべてのパネルを表示するか、会話と入力欄だけを表示します。',
    'Toggle Focus View': 'フォーカス表示の切り替え',
  },
  pt: {
    'Focus view': 'Modo foco',
    'Show the whole cockpit, or only the conversation and composer.':
      'Mostrar todo o painel, ou apenas a conversa e o campo de escrita.',
    'Toggle Focus View': 'Alternar modo foco',
  },
  ru: {
    'Focus view': 'Режим фокуса',
    'Show the whole cockpit, or only the conversation and composer.':
      'Показывать всю панель или только беседу и поле ввода.',
    'Toggle Focus View': 'Переключить режим фокуса',
  },
  th: {
    'Focus view': 'มุมมองโฟกัส',
    'Show the whole cockpit, or only the conversation and composer.':
      'แสดงแผงทั้งหมด หรือแสดงเฉพาะการสนทนาและช่องพิมพ์',
    'Toggle Focus View': 'สลับมุมมองโฟกัส',
  },
  zh: {
    'Focus view': '专注视图',
    'Show the whole cockpit, or only the conversation and composer.':
      '显示完整面板，或仅显示对话与输入框。',
    'Toggle Focus View': '切换专注视图',
  },
};

const onboardingTranslations = {
  ar: {
    'Do this next': 'الخطوة التالية',
    'Getting Started': 'البداية',
    'Load the model catalog': 'تحميل كتالوج النماذج',
    'Open a project folder': 'فتح مجلد مشروع',
    'Sign in to ClawAI': 'تسجيل الدخول إلى ClawAI',
    'Trust this workspace': 'الوثوق بمساحة العمل هذه',
  },
  de: {
    'Do this next': 'Als Nächstes',
    'Getting Started': 'Erste Schritte',
    'Load the model catalog': 'Modellkatalog laden',
    'Open a project folder': 'Projektordner öffnen',
    'Sign in to ClawAI': 'Bei ClawAI anmelden',
    'Trust this workspace': 'Diesem Arbeitsbereich vertrauen',
  },
  es: {
    'Do this next': 'Haz esto ahora',
    'Getting Started': 'Primeros pasos',
    'Load the model catalog': 'Carga el catálogo de modelos',
    'Open a project folder': 'Abre una carpeta de proyecto',
    'Sign in to ClawAI': 'Inicia sesión en ClawAI',
    'Trust this workspace': 'Confía en este espacio de trabajo',
  },
  fa: {
    'Do this next': 'گام بعدی',
    'Getting Started': 'شروع کار',
    'Load the model catalog': 'بارگذاری فهرست مدل‌ها',
    'Open a project folder': 'باز کردن پوشه پروژه',
    'Sign in to ClawAI': 'ورود به ClawAI',
    'Trust this workspace': 'اعتماد به این فضای کاری',
  },
  fr: {
    'Do this next': 'Étape suivante',
    'Getting Started': 'Prise en main',
    'Load the model catalog': 'Charger le catalogue de modèles',
    'Open a project folder': 'Ouvrir un dossier de projet',
    'Sign in to ClawAI': 'Se connecter à ClawAI',
    'Trust this workspace': 'Faire confiance à cet espace de travail',
  },
  hi: {
    'Do this next': 'अगला यह करें',
    'Getting Started': 'शुरू करें',
    'Load the model catalog': 'मॉडल कैटलॉग लोड करें',
    'Open a project folder': 'प्रोजेक्ट फ़ोल्डर खोलें',
    'Sign in to ClawAI': 'ClawAI में साइन इन करें',
    'Trust this workspace': 'इस वर्कस्पेस पर भरोसा करें',
  },
  it: {
    'Do this next': 'Passaggio successivo',
    'Getting Started': 'Per iniziare',
    'Load the model catalog': 'Carica il catalogo dei modelli',
    'Open a project folder': 'Apri una cartella di progetto',
    'Sign in to ClawAI': 'Accedi a ClawAI',
    'Trust this workspace': 'Considera attendibile questa area di lavoro',
  },
  ja: {
    'Do this next': '次はこれ',
    'Getting Started': 'はじめに',
    'Load the model catalog': 'モデルカタログを読み込む',
    'Open a project folder': 'プロジェクトフォルダーを開く',
    'Sign in to ClawAI': 'ClawAI にサインイン',
    'Trust this workspace': 'このワークスペースを信頼する',
  },
  pt: {
    'Do this next': 'Faça isto a seguir',
    'Getting Started': 'Primeiros passos',
    'Load the model catalog': 'Carregar o catálogo de modelos',
    'Open a project folder': 'Abrir uma pasta de projeto',
    'Sign in to ClawAI': 'Entrar no ClawAI',
    'Trust this workspace': 'Confiar neste espaço de trabalho',
  },
  ru: {
    'Do this next': 'Следующий шаг',
    'Getting Started': 'Начало работы',
    'Load the model catalog': 'Загрузить каталог моделей',
    'Open a project folder': 'Открыть папку проекта',
    'Sign in to ClawAI': 'Войти в ClawAI',
    'Trust this workspace': 'Доверять этой рабочей области',
  },
  th: {
    'Do this next': 'ทำสิ่งนี้ต่อไป',
    'Getting Started': 'เริ่มต้นใช้งาน',
    'Load the model catalog': 'โหลดแคตตาล็อกโมเดล',
    'Open a project folder': 'เปิดโฟลเดอร์โปรเจกต์',
    'Sign in to ClawAI': 'ลงชื่อเข้าใช้ ClawAI',
    'Trust this workspace': 'เชื่อถือเวิร์กสเปซนี้',
  },
  zh: {
    'Do this next': '下一步',
    'Getting Started': '快速开始',
    'Load the model catalog': '加载模型目录',
    'Open a project folder': '打开项目文件夹',
    'Sign in to ClawAI': '登录 ClawAI',
    'Trust this workspace': '信任此工作区',
  },
};

const turnNavigationTranslations = {
  ar: {
    '{who}, turn {position} of {total}': '{who}، الدور {position} من {total}',
  },
  de: {
    '{who}, turn {position} of {total}': '{who}, Beitrag {position} von {total}',
  },
  es: {
    '{who}, turn {position} of {total}': '{who}, turno {position} de {total}',
  },
  fa: {
    '{who}, turn {position} of {total}': '{who}، نوبت {position} از {total}',
  },
  fr: {
    '{who}, turn {position} of {total}': '{who}, tour {position} sur {total}',
  },
  hi: {
    '{who}, turn {position} of {total}': '{who}, बारी {position} / {total}',
  },
  it: {
    '{who}, turn {position} of {total}': '{who}, turno {position} di {total}',
  },
  ja: {
    '{who}, turn {position} of {total}': '{who}、{total} 件中 {position} 件目',
  },
  pt: {
    '{who}, turn {position} of {total}': '{who}, turno {position} de {total}',
  },
  ru: {
    '{who}, turn {position} of {total}': '{who}, реплика {position} из {total}',
  },
  th: {
    '{who}, turn {position} of {total}': '{who} ลำดับที่ {position} จาก {total}',
  },
  zh: {
    '{who}, turn {position} of {total}': '{who}，第 {position} 条，共 {total} 条',
  },
};

const statusLineTranslations = {
  ar: {
    Running: 'قيد التشغيل',
    'Running, {0} queued': 'قيد التشغيل، {0} في الانتظار',
    'Waiting for you': 'في انتظارك',
    '{0} queued': '{0} في الانتظار',
  },
  de: {
    Running: 'Läuft',
    'Running, {0} queued': 'Läuft, {0} in der Warteschlange',
    'Waiting for you': 'Wartet auf Sie',
    '{0} queued': '{0} in der Warteschlange',
  },
  es: {
    Running: 'En ejecución',
    'Running, {0} queued': 'En ejecución, {0} en cola',
    'Waiting for you': 'Esperándote',
    '{0} queued': '{0} en cola',
  },
  fa: {
    Running: 'در حال اجرا',
    'Running, {0} queued': 'در حال اجرا، {0} در صف',
    'Waiting for you': 'در انتظار شما',
    '{0} queued': '{0} در صف',
  },
  fr: {
    Running: 'En cours',
    'Running, {0} queued': 'En cours, {0} en file',
    'Waiting for you': 'En attente de vous',
    '{0} queued': '{0} en file',
  },
  hi: {
    Running: 'चल रहा है',
    'Running, {0} queued': 'चल रहा है, {0} कतार में',
    'Waiting for you': 'आपकी प्रतीक्षा में',
    '{0} queued': '{0} कतार में',
  },
  it: {
    Running: 'In esecuzione',
    'Running, {0} queued': 'In esecuzione, {0} in coda',
    'Waiting for you': 'In attesa di te',
    '{0} queued': '{0} in coda',
  },
  ja: {
    Running: '実行中',
    'Running, {0} queued': '実行中、{0} 件待機',
    'Waiting for you': '応答待ち',
    '{0} queued': '{0} 件待機',
  },
  pt: {
    Running: 'Em execução',
    'Running, {0} queued': 'Em execução, {0} na fila',
    'Waiting for you': 'Aguardando você',
    '{0} queued': '{0} na fila',
  },
  ru: {
    Running: 'Выполняется',
    'Running, {0} queued': 'Выполняется, в очереди: {0}',
    'Waiting for you': 'Ожидает вас',
    '{0} queued': 'В очереди: {0}',
  },
  th: {
    Running: 'กำลังทำงาน',
    'Running, {0} queued': 'กำลังทำงาน รออีก {0}',
    'Waiting for you': 'กำลังรอคุณ',
    '{0} queued': 'รออยู่ {0}',
  },
  zh: {
    Running: '运行中',
    'Running, {0} queued': '运行中，{0} 个排队',
    'Waiting for you': '等待你的操作',
    '{0} queued': '{0} 个排队',
  },
};

const coreSurfaceTranslations = {
  ar: {
    'A title is required.': 'العنوان مطلوب.',
    Agent: 'الوكيل',
    'Agent status': 'حالة الوكيل',
    'Agent workspace folder': 'مجلد مساحة عمل الوكيل',
    'Allow output here': 'السماح بالإخراج هنا',
    Allowed: 'مسموح',
    Answer: 'إجابة',
    'Applied file changes': 'طبقت تغييرات الملفات',
    'Apply file changes': 'تطبيق تغييرات الملفات',
    'Approval required': 'مطلوب موافقة',
    Approve: 'موافقة',
    'Approve agent effect': 'الموافقة على أثر الوكيل',
    'Approve browser navigation': 'الموافقة على تنقل المتصفح',
    'Ask ClawAI': 'اسأل ClawAI',
    'Automatic routing': 'التوجيه التلقائي',
    Backend: 'الخادم',
    'Bug report': 'تقرير خطأ',
    Cancelled: 'ألغي',
    'Changes rejected': 'رفضت التغييرات',
    Chat: 'محادثة',
  },
  de: {
    'A title is required.': 'Ein Titel ist erforderlich.',
    Agent: 'Agent',
    'Agent status': 'Agentenstatus',
    'Agent workspace folder': 'Arbeitsbereichsordner des Agenten',
    'Allow output here': 'Ausgabe hier erlauben',
    Allowed: 'Erlaubt',
    Answer: 'Antworten',
    'Applied file changes': 'Dateianderungen angewendet',
    'Apply file changes': 'Dateianderungen anwenden',
    'Approval required': 'Genehmigung erforderlich',
    Approve: 'Genehmigen',
    'Approve agent effect': 'Agentenaktion genehmigen',
    'Approve browser navigation': 'Browsernavigation genehmigen',
    'Ask ClawAI': 'ClawAI fragen',
    'Automatic routing': 'Automatisches Routing',
    Backend: 'Backend',
    'Bug report': 'Fehlerbericht',
    Cancelled: 'Abgebrochen',
    'Changes rejected': 'Anderungen abgelehnt',
    Chat: 'Chat',
  },
  es: {
    'A title is required.': 'Se requiere un titulo.',
    Agent: 'Agente',
    'Agent status': 'Estado del agente',
    'Agent workspace folder': 'Carpeta de trabajo del agente',
    'Allow output here': 'Permitir salida aqui',
    Allowed: 'Permitido',
    Answer: 'Responder',
    'Applied file changes': 'Cambios de archivos aplicados',
    'Apply file changes': 'Aplicar cambios de archivos',
    'Approval required': 'Se requiere aprobacion',
    Approve: 'Aprobar',
    'Approve agent effect': 'Aprobar el efecto del agente',
    'Approve browser navigation': 'Aprobar la navegacion del navegador',
    'Ask ClawAI': 'Pregunta a ClawAI',
    'Automatic routing': 'Enrutamiento automatico',
    Backend: 'Backend',
    'Bug report': 'Informe de error',
    Cancelled: 'Cancelado',
    'Changes rejected': 'Cambios rechazados',
    Chat: 'Chat',
  },
  fa: {
    'A title is required.': 'عنوان الزامی است.',
    Agent: 'عامل',
    'Agent status': 'وضعیت عامل',
    'Agent workspace folder': 'پوشه فضای کاری عامل',
    'Allow output here': 'اجازه خروجی در اینجا',
    Allowed: 'مجاز',
    Answer: 'پاسخ',
    'Applied file changes': 'تغییرات فایل اعمال شد',
    'Apply file changes': 'اعمال تغییرات فایل',
    'Approval required': 'نیازمند تأیید',
    Approve: 'تأیید',
    'Approve agent effect': 'تأیید اثر عامل',
    'Approve browser navigation': 'تأیید پیمایش مرورگر',
    'Ask ClawAI': 'از ClawAI بپرسید',
    'Automatic routing': 'مسیریابی خودکار',
    Backend: 'سرویس پشتیبان',
    'Bug report': 'گزارش اشکال',
    Cancelled: 'لغو شد',
    'Changes rejected': 'تغییرات رد شد',
    Chat: 'گفتگو',
  },
  fr: {
    'A title is required.': 'Un titre est requis.',
    Agent: 'Agent',
    'Agent status': 'Etat de l agent',
    'Agent workspace folder': 'Dossier de travail de l agent',
    'Allow output here': 'Autoriser la sortie ici',
    Allowed: 'Autorise',
    Answer: 'Repondre',
    'Applied file changes': 'Modifications appliquees',
    'Apply file changes': 'Appliquer les modifications',
    'Approval required': 'Approbation requise',
    Approve: 'Approuver',
    'Approve agent effect': 'Approuver l action de l agent',
    'Approve browser navigation': 'Approuver la navigation',
    'Ask ClawAI': 'Demander a ClawAI',
    'Automatic routing': 'Routage automatique',
    Backend: 'Backend',
    'Bug report': 'Rapport de bogue',
    Cancelled: 'Annule',
    'Changes rejected': 'Modifications refusees',
    Chat: 'Discussion',
  },
  hi: {
    'A title is required.': 'शीर्षक आवश्यक है।',
    Agent: 'एजेंट',
    'Agent status': 'एजेंट की स्थिति',
    'Agent workspace folder': 'एजेंट वर्कस्पेस फ़ोल्डर',
    'Allow output here': 'यहाँ आउटपुट की अनुमति दें',
    Allowed: 'अनुमत',
    Answer: 'उत्तर दें',
    'Applied file changes': 'फ़ाइल परिवर्तन लागू किए गए',
    'Apply file changes': 'फ़ाइल परिवर्तन लागू करें',
    'Approval required': 'अनुमोदन आवश्यक',
    Approve: 'अनुमोदित करें',
    'Approve agent effect': 'एजेंट प्रभाव अनुमोदित करें',
    'Approve browser navigation': 'ब्राउज़र नेविगेशन अनुमोदित करें',
    'Ask ClawAI': 'ClawAI से पूछें',
    'Automatic routing': 'स्वचालित रूटिंग',
    Backend: 'बैकएंड',
    'Bug report': 'बग रिपोर्ट',
    Cancelled: 'रद्द किया गया',
    'Changes rejected': 'परिवर्तन अस्वीकृत',
    Chat: 'चैट',
  },
  it: {
    'A title is required.': 'E richiesto un titolo.',
    Agent: 'Agente',
    'Agent status': 'Stato agente',
    'Agent workspace folder': 'Cartella di lavoro dell agente',
    'Allow output here': 'Consenti output qui',
    Allowed: 'Consentito',
    Answer: 'Rispondi',
    'Applied file changes': 'Modifiche ai file applicate',
    'Apply file changes': 'Applica le modifiche ai file',
    'Approval required': 'Approvazione richiesta',
    Approve: 'Approva',
    'Approve agent effect': 'Approva l effetto dell agente',
    'Approve browser navigation': 'Approva la navigazione',
    'Ask ClawAI': 'Chiedi a ClawAI',
    'Automatic routing': 'Instradamento automatico',
    Backend: 'Backend',
    'Bug report': 'Segnalazione di bug',
    Cancelled: 'Annullato',
    'Changes rejected': 'Modifiche rifiutate',
    Chat: 'Chat',
  },
  ja: {
    'A title is required.': 'タイトルが必要です。',
    Agent: 'エージェント',
    'Agent status': 'エージェントの状態',
    'Agent workspace folder': 'エージェントのワークスペースフォルダー',
    'Allow output here': 'ここへの出力を許可',
    Allowed: '許可済み',
    Answer: '回答',
    'Applied file changes': 'ファイルの変更を適用しました',
    'Apply file changes': 'ファイルの変更を適用',
    'Approval required': '承認が必要です',
    Approve: '承認',
    'Approve agent effect': 'エージェントの操作を承認',
    'Approve browser navigation': 'ブラウザーの遷移を承認',
    'Ask ClawAI': 'ClawAI に質問',
    'Automatic routing': '自動ルーティング',
    Backend: 'バックエンド',
    'Bug report': 'バグ報告',
    Cancelled: 'キャンセル済み',
    'Changes rejected': '変更は却下されました',
    Chat: 'チャット',
  },
  pt: {
    'A title is required.': 'E necessario um titulo.',
    Agent: 'Agente',
    'Agent status': 'Status do agente',
    'Agent workspace folder': 'Pasta de trabalho do agente',
    'Allow output here': 'Permitir saida aqui',
    Allowed: 'Permitido',
    Answer: 'Responder',
    'Applied file changes': 'Alteracoes de arquivos aplicadas',
    'Apply file changes': 'Aplicar alteracoes de arquivos',
    'Approval required': 'Aprovacao necessaria',
    Approve: 'Aprovar',
    'Approve agent effect': 'Aprovar o efeito do agente',
    'Approve browser navigation': 'Aprovar a navegacao do navegador',
    'Ask ClawAI': 'Perguntar ao ClawAI',
    'Automatic routing': 'Roteamento automatico',
    Backend: 'Backend',
    'Bug report': 'Relatorio de erro',
    Cancelled: 'Cancelado',
    'Changes rejected': 'Alteracoes rejeitadas',
    Chat: 'Conversa',
  },
  ru: {
    'A title is required.': 'Требуется заголовок.',
    Agent: 'Агент',
    'Agent status': 'Состояние агента',
    'Agent workspace folder': 'Папка рабочей области агента',
    'Allow output here': 'Разрешить вывод сюда',
    Allowed: 'Разрешено',
    Answer: 'Ответить',
    'Applied file changes': 'Изменения файлов применены',
    'Apply file changes': 'Применить изменения файлов',
    'Approval required': 'Требуется подтверждение',
    Approve: 'Подтвердить',
    'Approve agent effect': 'Подтвердить действие агента',
    'Approve browser navigation': 'Подтвердить переход в браузере',
    'Ask ClawAI': 'Спросить ClawAI',
    'Automatic routing': 'Автоматическая маршрутизация',
    Backend: 'Бэкенд',
    'Bug report': 'Сообщение об ошибке',
    Cancelled: 'Отменено',
    'Changes rejected': 'Изменения отклонены',
    Chat: 'Чат',
  },
  th: {
    'A title is required.': 'ต้องระบุชื่อเรื่อง',
    Agent: 'เอเจนต์',
    'Agent status': 'สถานะเอเจนต์',
    'Agent workspace folder': 'โฟลเดอร์เวิร์กสเปซของเอเจนต์',
    'Allow output here': 'อนุญาตให้เขียนผลลัพธ์ที่นี่',
    Allowed: 'อนุญาตแล้ว',
    Answer: 'ตอบ',
    'Applied file changes': 'ใช้การเปลี่ยนแปลงไฟล์แล้ว',
    'Apply file changes': 'ใช้การเปลี่ยนแปลงไฟล์',
    'Approval required': 'ต้องได้รับการอนุมัติ',
    Approve: 'อนุมัติ',
    'Approve agent effect': 'อนุมัติการกระทำของเอเจนต์',
    'Approve browser navigation': 'อนุมัติการนำทางของเบราว์เซอร์',
    'Ask ClawAI': 'ถาม ClawAI',
    'Automatic routing': 'การกำหนดเส้นทางอัตโนมัติ',
    Backend: 'แบ็กเอนด์',
    'Bug report': 'รายงานข้อบกพร่อง',
    Cancelled: 'ยกเลิกแล้ว',
    'Changes rejected': 'ปฏิเสธการเปลี่ยนแปลงแล้ว',
    Chat: 'แชท',
  },
  zh: {
    'A title is required.': '需要标题。',
    Agent: '智能体',
    'Agent status': '智能体状态',
    'Agent workspace folder': '智能体工作区文件夹',
    'Allow output here': '允许输出到此处',
    Allowed: '已允许',
    Answer: '回答',
    'Applied file changes': '已应用文件更改',
    'Apply file changes': '应用文件更改',
    'Approval required': '需要批准',
    Approve: '批准',
    'Approve agent effect': '批准智能体操作',
    'Approve browser navigation': '批准浏览器导航',
    'Ask ClawAI': '询问 ClawAI',
    'Automatic routing': '自动路由',
    Backend: '后端',
    'Bug report': '错误报告',
    Cancelled: '已取消',
    'Changes rejected': '更改已拒绝',
    Chat: '对话',
  },
};

const outputStyleTranslations = {
  ar: {
    Concise: 'موجز',
    Default: 'افتراضي',
    'Defined by this project': 'معرف بواسطة هذا المشروع',
    Explanatory: 'تفسيري',
    'How should answers be written?': 'كيف ينبغي كتابة الإجابات؟',
    Learning: 'تعليمي',
    'Select Output Style': 'اختيار أسلوب الإخراج',
  },
  de: {
    Concise: 'Knapp',
    Default: 'Standard',
    'Defined by this project': 'Von diesem Projekt definiert',
    Explanatory: 'Erklärend',
    'How should answers be written?': 'Wie sollen Antworten geschrieben werden?',
    Learning: 'Lernmodus',
    'Select Output Style': 'Ausgabestil wählen',
  },
  es: {
    Concise: 'Conciso',
    Default: 'Predeterminado',
    'Defined by this project': 'Definido por este proyecto',
    Explanatory: 'Explicativo',
    'How should answers be written?': '¿Cómo deben escribirse las respuestas?',
    Learning: 'Aprendizaje',
    'Select Output Style': 'Seleccionar estilo de respuesta',
  },
  fa: {
    Concise: 'مختصر',
    Default: 'پیش‌فرض',
    'Defined by this project': 'تعریف‌شده توسط این پروژه',
    Explanatory: 'توضیحی',
    'How should answers be written?': 'پاسخ‌ها چگونه نوشته شوند؟',
    Learning: 'یادگیری',
    'Select Output Style': 'انتخاب سبک خروجی',
  },
  fr: {
    Concise: 'Concis',
    Default: 'Par défaut',
    'Defined by this project': 'Défini par ce projet',
    Explanatory: 'Explicatif',
    'How should answers be written?': 'Comment les réponses doivent-elles être écrites ?',
    Learning: 'Apprentissage',
    'Select Output Style': 'Choisir le style de réponse',
  },
  hi: {
    Concise: 'संक्षिप्त',
    Default: 'डिफ़ॉल्ट',
    'Defined by this project': 'इस प्रोजेक्ट द्वारा परिभाषित',
    Explanatory: 'व्याख्यात्मक',
    'How should answers be written?': 'उत्तर कैसे लिखे जाएँ?',
    Learning: 'सीखने वाला',
    'Select Output Style': 'आउटपुट शैली चुनें',
  },
  it: {
    Concise: 'Conciso',
    Default: 'Predefinito',
    'Defined by this project': 'Definito da questo progetto',
    Explanatory: 'Esplicativo',
    'How should answers be written?': 'Come devono essere scritte le risposte?',
    Learning: 'Apprendimento',
    'Select Output Style': 'Seleziona stile di risposta',
  },
  ja: {
    Concise: '簡潔',
    Default: '既定',
    'Defined by this project': 'このプロジェクトで定義',
    Explanatory: '解説重視',
    'How should answers be written?': '回答の書き方は？',
    Learning: '学習向け',
    'Select Output Style': '出力スタイルを選択',
  },
  pt: {
    Concise: 'Conciso',
    Default: 'Padrão',
    'Defined by this project': 'Definido por este projeto',
    Explanatory: 'Explicativo',
    'How should answers be written?': 'Como as respostas devem ser escritas?',
    Learning: 'Aprendizado',
    'Select Output Style': 'Selecionar estilo de resposta',
  },
  ru: {
    Concise: 'Кратко',
    Default: 'По умолчанию',
    'Defined by this project': 'Определено этим проектом',
    Explanatory: 'С пояснениями',
    'How should answers be written?': 'Как писать ответы?',
    Learning: 'Обучение',
    'Select Output Style': 'Выбрать стиль ответа',
  },
  th: {
    Concise: 'กระชับ',
    Default: 'ค่าเริ่มต้น',
    'Defined by this project': 'กำหนดโดยโปรเจกต์นี้',
    Explanatory: 'อธิบายละเอียด',
    'How should answers be written?': 'ควรเขียนคำตอบอย่างไร',
    Learning: 'เพื่อการเรียนรู้',
    'Select Output Style': 'เลือกรูปแบบคำตอบ',
  },
  zh: {
    Concise: '简洁',
    Default: '默认',
    'Defined by this project': '由本项目定义',
    Explanatory: '讲解式',
    'How should answers be written?': '答案应该怎么写？',
    Learning: '教学式',
    'Select Output Style': '选择输出风格',
  },
};

const settingDescriptionTranslations = {
  ar: {
    'Commands to run at points in a run. Configured here rather than in `.clawai` on purpose: a hook runs a command, and reading one from workspace content would make cloning a repository enough to execute code. Only a `before-tool` hook marked `blocking` can stop a call; everything else is advisory.':
      'أوامر تُشغَّل عند نقاط في التشغيل. تُضبط هنا وليس في `.clawai` عن قصد: الخطاف يشغل أمراً، وقراءته من محتوى مساحة العمل تجعل استنساخ مستودع كافياً لتنفيذ التعليمات البرمجية. الخطاف من نوع `before-tool` الموسوم بـ `blocking` وحده يمكنه إيقاف الاستدعاء؛ وكل ما عداه إرشادي.',
    'How answers are written: default, concise, explanatory, learning, or a style this workspace defines.':
      'كيفية كتابة الإجابات: افتراضي، موجز، تفسيري، تعليمي، أو أسلوب تعرّفه مساحة العمل هذه.',
  },
  de: {
    'Commands to run at points in a run. Configured here rather than in `.clawai` on purpose: a hook runs a command, and reading one from workspace content would make cloning a repository enough to execute code. Only a `before-tool` hook marked `blocking` can stop a call; everything else is advisory.':
      'Befehle, die an Punkten eines Laufs ausgeführt werden. Absichtlich hier statt in `.clawai` konfiguriert: ein Hook fuehrt einen Befehl aus, und ihn aus Arbeitsbereichsinhalten zu lesen würde bedeuten, dass das Klonen eines Repositorys zum Ausfuehren von Code genügt. Nur ein als `blocking` markierter `before-tool`-Hook kann einen Aufruf stoppen; alles andere ist beratend.',
    'How answers are written: default, concise, explanatory, learning, or a style this workspace defines.':
      'Wie Antworten geschrieben werden: Standard, knapp, erklärend, Lernmodus oder ein von diesem Arbeitsbereich definierter Stil.',
  },
  es: {
    'Commands to run at points in a run. Configured here rather than in `.clawai` on purpose: a hook runs a command, and reading one from workspace content would make cloning a repository enough to execute code. Only a `before-tool` hook marked `blocking` can stop a call; everything else is advisory.':
      'Comandos que se ejecutan en puntos de una ejecución. Se configuran aquí y no en `.clawai` a propósito: un hook ejecuta un comando, y leerlo del contenido del espacio de trabajo haría que clonar un repositorio bastara para ejecutar código. Solo un hook `before-tool` marcado como `blocking` puede detener una llamada; todo lo demas es informativo.',
    'How answers are written: default, concise, explanatory, learning, or a style this workspace defines.':
      'Cómo se escriben las respuestas: predeterminado, conciso, explicativo, aprendizaje o un estilo que defina este espacio de trabajo.',
  },
  fa: {
    'Commands to run at points in a run. Configured here rather than in `.clawai` on purpose: a hook runs a command, and reading one from workspace content would make cloning a repository enough to execute code. Only a `before-tool` hook marked `blocking` can stop a call; everything else is advisory.':
      'فرمان‌هایی که در نقاطی از اجرا اجرا می‌شوند. عمداً به جای `.clawai` اینجا تنظیم می‌شوند: یک قلاب فرمان اجرا می‌کند و خواندن آن از محتوای فضای کاری یعنی کلون‌کردن یک مخزن برای اجرای کد کافی است. تنها قلاب `before-tool` با نشان `blocking` می‌تواند یک فراخوانی را متوقف کند؛ بقیه صرفاً اطلاع‌رسانی‌اند.',
    'How answers are written: default, concise, explanatory, learning, or a style this workspace defines.':
      'نحوه نوشتن پاسخ‌ها: پیش‌فرض، مختصر، توضیحی، یادگیری، یا سبکی که این فضای کاری تعریف می‌کند.',
  },
  fr: {
    'Commands to run at points in a run. Configured here rather than in `.clawai` on purpose: a hook runs a command, and reading one from workspace content would make cloning a repository enough to execute code. Only a `before-tool` hook marked `blocking` can stop a call; everything else is advisory.':
      "Commandes exécutées à certains moments d'une exécution. Configurees ici plutôt que dans `.clawai` à dessein : un hook exécute une commande, et le lire depuis le contenu de l'espace de travail signifierait que cloner un depot suffit à exécuter du code. Seul un hook `before-tool` marque `blocking` peut arrêter un appel ; tout le reste est consultatif.",
    'How answers are written: default, concise, explanatory, learning, or a style this workspace defines.':
      'Comment les réponses sont écrites : par défaut, concis, explicatif, apprentissage, ou un style défini par cet espace de travail.',
  },
  hi: {
    'Commands to run at points in a run. Configured here rather than in `.clawai` on purpose: a hook runs a command, and reading one from workspace content would make cloning a repository enough to execute code. Only a `before-tool` hook marked `blocking` can stop a call; everything else is advisory.':
      'रन के कुछ बिंदुओं पर चलने वाले कमांड। इन्हें `.clawai` के बजाय यहाँ जानबूझकर कॉन्फ़िगर किया जाता है: एक हुक कमांड चलाता है, और उसे वर्कस्पेस सामग्री से पढ़ने का अर्थ होगा कि रिपॉज़िटरी क्लोन करना ही कोड चलाने के लिए पर्याप्त है। केवल `blocking` चिह्नित `before-tool` हुक ही किसी कॉल को रोक सकता है; बाकी सब सलाहकारी है।',
    'How answers are written: default, concise, explanatory, learning, or a style this workspace defines.':
      'उत्तर कैसे लिखे जाते हैं: डिफ़ॉल्ट, संक्षिप्त, व्याख्यात्मक, सीखने वाला, या इस वर्कस्पेस द्वारा परिभाषित शैली।',
  },
  it: {
    'Commands to run at points in a run. Configured here rather than in `.clawai` on purpose: a hook runs a command, and reading one from workspace content would make cloning a repository enough to execute code. Only a `before-tool` hook marked `blocking` can stop a call; everything else is advisory.':
      "Comandi eseguiti in punti di una esecuzione. Configurati qui e non in `.clawai` di propósito: un hook esegue un comando, e leggerlo dal contenuto dell'area di lavoro significherebbe che clonare un repository basta a eseguire codice. Solo un hook `before-tool` contrassegnato `blocking` può fermare una chiamata; tutto il resto è consultivo.",
    'How answers are written: default, concise, explanatory, learning, or a style this workspace defines.':
      'Come vengono scritte le risposte: predefinito, conciso, esplicativo, apprendimento o uno stile definito da questa area di lavoro.',
  },
  ja: {
    'Commands to run at points in a run. Configured here rather than in `.clawai` on purpose: a hook runs a command, and reading one from workspace content would make cloning a repository enough to execute code. Only a `before-tool` hook marked `blocking` can stop a call; everything else is advisory.':
      '実行中の特定の時点で走らせるコマンド。`.clawai` ではなくここで設定するのは意図的です。フックはコマンドを実行するため、ワークスペースの内容から読み込むと、リポジトリを複製するだけでコードが実行できてしまいます。呼び出しを止められるのは `blocking` を付けた `before-tool` フックだけで、それ以外は助言的です。',
    'How answers are written: default, concise, explanatory, learning, or a style this workspace defines.':
      '回答の書き方: 既定、簡潔、解説重視、学習向け、またはこのワークスペースが定義したスタイル。',
  },
  pt: {
    'Commands to run at points in a run. Configured here rather than in `.clawai` on purpose: a hook runs a command, and reading one from workspace content would make cloning a repository enough to execute code. Only a `before-tool` hook marked `blocking` can stop a call; everything else is advisory.':
      'Comandos executados em pontos de uma execução. Configurados aquí e não em `.clawai` de propósito: um hook executa um comando, e lê-lo do conteudo do espaço de trabalho faria com que clonar um repositorio bastasse para executar código. Apenas um hook `before-tool` marcado como `blocking` pode parar uma chamada; todo o resto è consultivo.',
    'How answers are written: default, concise, explanatory, learning, or a style this workspace defines.':
      'Como as respostas são escritas: padrão, conciso, explicativo, aprendizado ou um estilo definido por este espaço de trabalho.',
  },
  ru: {
    'Commands to run at points in a run. Configured here rather than in `.clawai` on purpose: a hook runs a command, and reading one from workspace content would make cloning a repository enough to execute code. Only a `before-tool` hook marked `blocking` can stop a call; everything else is advisory.':
      'Команды, запускаемые в определённых точках выполнения. Настраиваются здесь, а не в `.clawai`, намеренно: хук запускает команду, и чтение его из содержимого рабочей области означало бы, что клонирования репозитория достаточно для выполнения кода. Остановить вызов может только хук `before-tool` с пометкой `blocking`; всё остальное носит рекомендательный характер.',
    'How answers are written: default, concise, explanatory, learning, or a style this workspace defines.':
      'Как пишутся ответы: по умолчанию, кратко, с пояснениями, обучение или стиль, заданный этой рабочей областью.',
  },
  th: {
    'Commands to run at points in a run. Configured here rather than in `.clawai` on purpose: a hook runs a command, and reading one from workspace content would make cloning a repository enough to execute code. Only a `before-tool` hook marked `blocking` can stop a call; everything else is advisory.':
      'คำสั่งที่รัน ณ จุดต่าง ๆ ของการทำงาน ตั้งค่าที่นี่แทนที่จะเป็นใน `.clawai` โดยเจตนา เพราะฮุกจะรันคำสั่ง และการอ่านฮุกจากเนื้อหาในเวิร์กสเปซจะทำให้แค่โคลนรีโพก็รันโค้ดได้ มีเพียงฮุก `before-tool` ที่ทำเครื่องหมาย `blocking` เท่านั้นที่หยุดการเรียกได้ ส่วนที่เหลือเป็นเพียงคำแนะนำ',
    'How answers are written: default, concise, explanatory, learning, or a style this workspace defines.':
      'รูปแบบการเขียนคำตอบ: ค่าเริ่มต้น กระชับ อธิบายละเอียด เพื่อการเรียนรู้ หรือรูปแบบที่เวิร์กสเปซนี้กำหนด',
  },
  zh: {
    'Commands to run at points in a run. Configured here rather than in `.clawai` on purpose: a hook runs a command, and reading one from workspace content would make cloning a repository enough to execute code. Only a `before-tool` hook marked `blocking` can stop a call; everything else is advisory.':
      '在运行的特定时刻执行的命令。特意配置在这里而不是 `.clawai`：钩子会执行命令，若从工作区内容读取，克隆一个仓库就足以执行代码。只有标记为 `blocking` 的 `before-tool` 钩子才能阻止调用，其余均为提示性质。',
    'How answers are written: default, concise, explanatory, learning, or a style this workspace defines.':
      '答案的书写方式：默认、简洁、讲解式、教学式，或本工作区自定义的风格。',
  },
};

const attachmentTranslations = {
  ar: {
    '{0} was not sent: the image is too large to read.': 'لم يُرسل {0}: الصورة أكبر من أن تُقرأ.',
    '{0} was not sent: the selected model cannot read images.':
      'لم يُرسل {0}: النموذج المحدد لا يمكنه قراءة الصور.',
    '{0} was not sent: this message already carries enough images.':
      'لم يُرسل {0}: هذه الرسالة تحمل صوراً كافية بالفعل.',
  },
  de: {
    '{0} was not sent: the image is too large to read.':
      '{0} wurde nicht gesendet: das Bild ist zu groß zum Lesen.',
    '{0} was not sent: the selected model cannot read images.':
      '{0} wurde nicht gesendet: das gewählte Modell kann keine Bilder lesen.',
    '{0} was not sent: this message already carries enough images.':
      '{0} wurde nicht gesendet: diese Nachricht enthält bereits genug Bilder.',
  },
  es: {
    '{0} was not sent: the image is too large to read.':
      '{0} no se envió: la imagen es demasiado grande para leerla.',
    '{0} was not sent: the selected model cannot read images.':
      '{0} no se envió: el modelo seleccionado no puede leer imágenes.',
    '{0} was not sent: this message already carries enough images.':
      '{0} no se envió: este mensaje ya lleva suficientes imágenes.',
  },
  fa: {
    '{0} was not sent: the image is too large to read.':
      '{0} ارسال نشد: تصویر برای خواندن بیش از حد بزرگ است.',
    '{0} was not sent: the selected model cannot read images.':
      '{0} ارسال نشد: مدل انتخاب‌شده نمی‌تواند تصویر بخواند.',
    '{0} was not sent: this message already carries enough images.':
      '{0} ارسال نشد: این پیام هم‌اکنون تصاویر کافی دارد.',
  },
  fr: {
    '{0} was not sent: the image is too large to read.':
      "{0} n'a pas été envoyé : l'image est trop grande pour être lue.",
    '{0} was not sent: the selected model cannot read images.':
      "{0} n'a pas été envoyé : le modèle sélectionné ne peut pas lire les images.",
    '{0} was not sent: this message already carries enough images.':
      "{0} n'a pas été envoyé : ce message contient déjà assez d'images.",
  },
  hi: {
    '{0} was not sent: the image is too large to read.':
      '{0} नहीं भेजा गया: छवि पढ़ने के लिए बहुत बड़ी है।',
    '{0} was not sent: the selected model cannot read images.':
      '{0} नहीं भेजा गया: चयनित मॉडल छवियाँ नहीं पढ़ सकता।',
    '{0} was not sent: this message already carries enough images.':
      '{0} नहीं भेजा गया: इस संदेश में पहले से पर्याप्त छवियाँ हैं।',
  },
  it: {
    '{0} was not sent: the image is too large to read.':
      "{0} non è stato inviato: l'immagine è troppo grande da leggere.",
    '{0} was not sent: the selected model cannot read images.':
      '{0} non è stato inviato: il modello selezionato non può leggere immagini.',
    '{0} was not sent: this message already carries enough images.':
      '{0} non è stato inviato: questo messaggio contiene già abbastanza immagini.',
  },
  ja: {
    '{0} was not sent: the image is too large to read.':
      '{0} は送信されませんでした。画像が大きすぎて読めません。',
    '{0} was not sent: the selected model cannot read images.':
      '{0} は送信されませんでした。選択中のモデルは画像を読めません。',
    '{0} was not sent: this message already carries enough images.':
      '{0} は送信されませんでした。このメッセージには既に十分な画像があります。',
  },
  pt: {
    '{0} was not sent: the image is too large to read.':
      '{0} não foi enviado: a imagem é grande demais para ser lida.',
    '{0} was not sent: the selected model cannot read images.':
      '{0} não foi enviado: o modelo selecionado não consegue ler imagens.',
    '{0} was not sent: this message already carries enough images.':
      '{0} não foi enviado: esta mensagem já carrega imagens suficientes.',
  },
  ru: {
    '{0} was not sent: the image is too large to read.':
      '{0} не отправлен: изображение слишком большое.',
    '{0} was not sent: the selected model cannot read images.':
      '{0} не отправлен: выбранная модель не читает изображения.',
    '{0} was not sent: this message already carries enough images.':
      '{0} не отправлен: в этом сообщении уже достаточно изображений.',
  },
  th: {
    '{0} was not sent: the image is too large to read.':
      'ไม่ได้ส่ง {0} เพราะรูปภาพใหญ่เกินกว่าจะอ่านได้',
    '{0} was not sent: the selected model cannot read images.':
      'ไม่ได้ส่ง {0} เพราะโมเดลที่เลือกอ่านรูปภาพไม่ได้',
    '{0} was not sent: this message already carries enough images.':
      'ไม่ได้ส่ง {0} เพราะข้อความนี้มีรูปภาพมากพอแล้ว',
  },
  zh: {
    '{0} was not sent: the image is too large to read.': '未发送 {0}：图像过大，无法读取。',
    '{0} was not sent: the selected model cannot read images.':
      '未发送 {0}：所选模型无法读取图像。',
    '{0} was not sent: this message already carries enough images.':
      '未发送 {0}：这条消息已经包含足够多的图像。',
  },
};

const contextWarningTranslations = {
  ar: {
    'Nearly out of room. The next message may not fit.':
      'أوشكت المساحة على النفاد. قد لا تتسع الرسالة التالية.',
    'This message will not fit. The oldest of the conversation will be dropped.':
      'لن تتسع هذه الرسالة. سيُسقط أقدم جزء من المحادثة.',
  },
  de: {
    'Nearly out of room. The next message may not fit.':
      'Fast kein Platz mehr. Die nächste Nachricht passt möglicherweise nicht.',
    'This message will not fit. The oldest of the conversation will be dropped.':
      'Diese Nachricht passt nicht. Das Älteste der Unterhaltung wird verworfen.',
  },
  es: {
    'Nearly out of room. The next message may not fit.':
      'Casi sin espacio. El próximo mensaje puede no caber.',
    'This message will not fit. The oldest of the conversation will be dropped.':
      'Este mensaje no cabe. Se descartará lo más antiguo de la conversación.',
  },
  fa: {
    'Nearly out of room. The next message may not fit.':
      'فضا رو به اتمام است. ممکن است پیام بعدی جا نشود.',
    'This message will not fit. The oldest of the conversation will be dropped.':
      'این پیام جا نمی‌شود. قدیمی‌ترین بخش گفتگو حذف خواهد شد.',
  },
  fr: {
    'Nearly out of room. The next message may not fit.':
      'Presque plus de place. Le prochain message pourrait ne pas tenir.',
    'This message will not fit. The oldest of the conversation will be dropped.':
      'Ce message ne tient pas. Le plus ancien de la conversation sera supprimé.',
  },
  hi: {
    'Nearly out of room. The next message may not fit.': 'जगह लगभग समाप्त। अगला संदेश शायद न समाए।',
    'This message will not fit. The oldest of the conversation will be dropped.':
      'यह संदेश नहीं समाएगा। बातचीत का सबसे पुराना हिस्सा हटा दिया जाएगा।',
  },
  it: {
    'Nearly out of room. The next message may not fit.':
      'Quasi senza spazio. Il prossimo messaggio potrebbe non entrare.',
    'This message will not fit. The oldest of the conversation will be dropped.':
      'Questo messaggio non entra. La parte più vecchia della conversazione verrà scartata.',
  },
  ja: {
    'Nearly out of room. The next message may not fit.':
      '残り容量がわずかです。次のメッセージは収まらないかもしれません。',
    'This message will not fit. The oldest of the conversation will be dropped.':
      'このメッセージは収まりません。会話の最も古い部分が削除されます。',
  },
  pt: {
    'Nearly out of room. The next message may not fit.':
      'Quase sem espaço. A próxima mensagem pode não caber.',
    'This message will not fit. The oldest of the conversation will be dropped.':
      'Esta mensagem não cabe. A parte mais antiga da conversa será descartada.',
  },
  ru: {
    'Nearly out of room. The next message may not fit.':
      'Места почти нет. Следующее сообщение может не поместиться.',
    'This message will not fit. The oldest of the conversation will be dropped.':
      'Это сообщение не поместится. Самая старая часть беседы будет отброшена.',
  },
  th: {
    'Nearly out of room. The next message may not fit.': 'พื้นที่ใกล้เต็มแล้ว ข้อความถัดไปอาจไม่พอ',
    'This message will not fit. The oldest of the conversation will be dropped.':
      'ข้อความนี้ใหญ่เกินไป ส่วนที่เก่าที่สุดของการสนทนาจะถูกตัดออก',
  },
  zh: {
    'Nearly out of room. The next message may not fit.': '空间快用完了，下一条消息可能放不下。',
    'This message will not fit. The oldest of the conversation will be dropped.':
      '这条消息放不下，对话中最早的部分将被丢弃。',
  },
};

const compactionTranslations = {
  ar: {
    'Compact Conversation': 'ضغط المحادثة',
    'Open a conversation before compacting it.': 'افتح محادثة قبل ضغطها.',
    'Summarize and continue': 'التلخيص والمتابعة',
    'Summarize this conversation and continue in a new one?':
      'تلخيص هذه المحادثة والمتابعة في محادثة جديدة؟',
    'Summarizing…': 'جارٍ التلخيص…',
    'The original conversation is kept and stays in your history.':
      'تُحفظ المحادثة الأصلية وتبقى في سجلك.',
    'The summary came back empty, so nothing was changed.': 'عاد الملخص فارغاً، لذا لم يتغير شيء.',
  },
  de: {
    'Compact Conversation': 'Unterhaltung verdichten',
    'Open a conversation before compacting it.':
      'Öffnen Sie eine Unterhaltung, bevor Sie sie verdichten.',
    'Summarize and continue': 'Zusammenfassen und fortsetzen',
    'Summarize this conversation and continue in a new one?':
      'Diese Unterhaltung zusammenfassen und in einer neuen fortsetzen?',
    'Summarizing…': 'Wird zusammengefasst…',
    'The original conversation is kept and stays in your history.':
      'Die ursprüngliche Unterhaltung bleibt erhalten und in Ihrem Verlauf.',
    'The summary came back empty, so nothing was changed.':
      'Die Zusammenfassung kam leer zurück, daher wurde nichts geändert.',
  },
  es: {
    'Compact Conversation': 'Compactar conversación',
    'Open a conversation before compacting it.': 'Abre una conversación antes de compactarla.',
    'Summarize and continue': 'Resumir y continuar',
    'Summarize this conversation and continue in a new one?':
      '¿Resumir esta conversación y continuar en una nueva?',
    'Summarizing…': 'Resumiendo…',
    'The original conversation is kept and stays in your history.':
      'La conversación original se conserva y permanece en tu historial.',
    'The summary came back empty, so nothing was changed.':
      'El resumen llegó vacío, así que no se cambió nada.',
  },
  fa: {
    'Compact Conversation': 'فشرده‌سازی گفتگو',
    'Open a conversation before compacting it.': 'پیش از فشرده‌سازی، یک گفتگو باز کنید.',
    'Summarize and continue': 'خلاصه‌سازی و ادامه',
    'Summarize this conversation and continue in a new one?':
      'این گفتگو خلاصه شود و در گفتگوی جدیدی ادامه یابد؟',
    'Summarizing…': 'در حال خلاصه‌سازی…',
    'The original conversation is kept and stays in your history.':
      'گفتگوی اصلی نگه داشته می‌شود و در تاریخچه می‌ماند.',
    'The summary came back empty, so nothing was changed.':
      'خلاصه خالی بازگشت، بنابراین چیزی تغییر نکرد.',
  },
  fr: {
    'Compact Conversation': 'Compacter la conversation',
    'Open a conversation before compacting it.': 'Ouvrez une conversation avant de la compacter.',
    'Summarize and continue': 'Résumer et continuer',
    'Summarize this conversation and continue in a new one?':
      'Résumer cette conversation et continuer dans une nouvelle ?',
    'Summarizing…': 'Résumé en cours…',
    'The original conversation is kept and stays in your history.':
      "La conversation d'origine est conservée et reste dans votre historique.",
    'The summary came back empty, so nothing was changed.':
      "Le résumé est revenu vide, rien n'a donc été changé.",
  },
  hi: {
    'Compact Conversation': 'बातचीत संक्षिप्त करें',
    'Open a conversation before compacting it.': 'संक्षिप्त करने से पहले कोई बातचीत खोलें।',
    'Summarize and continue': 'सारांश बनाकर जारी रखें',
    'Summarize this conversation and continue in a new one?':
      'इस बातचीत का सारांश बनाकर नई बातचीत में जारी रखें?',
    'Summarizing…': 'सारांश बन रहा है…',
    'The original conversation is kept and stays in your history.':
      'मूल बातचीत सुरक्षित रहती है और आपके इतिहास में बनी रहती है।',
    'The summary came back empty, so nothing was changed.': 'सारांश खाली आया, इसलिए कुछ नहीं बदला।',
  },
  it: {
    'Compact Conversation': 'Compatta la conversazione',
    'Open a conversation before compacting it.': 'Apri una conversazione prima di compattarla.',
    'Summarize and continue': 'Riassumi e continua',
    'Summarize this conversation and continue in a new one?':
      'Riassumere questa conversazione e continuare in una nuova?',
    'Summarizing…': 'Riassunto in corso…',
    'The original conversation is kept and stays in your history.':
      'La conversazione originale viene conservata e resta nella cronologia.',
    'The summary came back empty, so nothing was changed.':
      'Il riassunto è tornato vuoto, quindi nulla è stato cambiato.',
  },
  ja: {
    'Compact Conversation': '会話を圧縮',
    'Open a conversation before compacting it.': '圧縮する前に会話を開いてください。',
    'Summarize and continue': '要約して続ける',
    'Summarize this conversation and continue in a new one?':
      'この会話を要約して新しい会話で続けますか？',
    'Summarizing…': '要約しています…',
    'The original conversation is kept and stays in your history.':
      '元の会話はそのまま履歴に残ります。',
    'The summary came back empty, so nothing was changed.':
      '要約が空で返ってきたため、何も変更していません。',
  },
  pt: {
    'Compact Conversation': 'Compactar conversa',
    'Open a conversation before compacting it.': 'Abra uma conversa antes de compactá-la.',
    'Summarize and continue': 'Resumir e continuar',
    'Summarize this conversation and continue in a new one?':
      'Resumir esta conversa e continuar em uma nova?',
    'Summarizing…': 'Resumindo…',
    'The original conversation is kept and stays in your history.':
      'A conversa original é mantida e permanece no seu histórico.',
    'The summary came back empty, so nothing was changed.':
      'O resumo voltou vazio, então nada foi alterado.',
  },
  ru: {
    'Compact Conversation': 'Сжать беседу',
    'Open a conversation before compacting it.': 'Откройте беседу, прежде чем сжимать её.',
    'Summarize and continue': 'Подвести итог и продолжить',
    'Summarize this conversation and continue in a new one?':
      'Подвести итог беседы и продолжить в новой?',
    'Summarizing…': 'Подведение итога…',
    'The original conversation is kept and stays in your history.':
      'Исходная беседа сохраняется и остаётся в истории.',
    'The summary came back empty, so nothing was changed.':
      'Итог вернулся пустым, поэтому ничего не изменилось.',
  },
  th: {
    'Compact Conversation': 'ย่อการสนทนา',
    'Open a conversation before compacting it.': 'เปิดการสนทนาก่อนย่อ',
    'Summarize and continue': 'สรุปแล้วดำเนินต่อ',
    'Summarize this conversation and continue in a new one?':
      'สรุปการสนทนานี้แล้วดำเนินต่อในการสนทนาใหม่หรือไม่',
    'Summarizing…': 'กำลังสรุป…',
    'The original conversation is kept and stays in your history.':
      'การสนทนาเดิมจะถูกเก็บไว้ในประวัติ',
    'The summary came back empty, so nothing was changed.':
      'ได้สรุปเป็นค่าว่าง จึงไม่มีการเปลี่ยนแปลง',
  },
  zh: {
    'Compact Conversation': '压缩对话',
    'Open a conversation before compacting it.': '请先打开一个对话再压缩。',
    'Summarize and continue': '总结并继续',
    'Summarize this conversation and continue in a new one?': '总结这段对话并在新对话中继续？',
    'Summarizing…': '正在总结…',
    'The original conversation is kept and stays in your history.':
      '原对话会保留并留在历史记录中。',
    'The summary came back empty, so nothing was changed.': '总结返回为空，因此未做任何更改。',
  },
};

const newWindowTranslations = {
  ar: {
    'Open Conversation in New Window': 'فتح المحادثة في نافذة جديدة',
    'Open a conversation before moving it to a new window.':
      'افتح محادثة قبل نقلها إلى نافذة جديدة.',
    'Open a folder before opening a conversation in a new window.':
      'افتح مجلداً قبل فتح محادثة في نافذة جديدة.',
  },
  de: {
    'Open Conversation in New Window': 'Unterhaltung in neuem Fenster öffnen',
    'Open a conversation before moving it to a new window.':
      'Öffnen Sie eine Unterhaltung, bevor Sie sie in ein neues Fenster verschieben.',
    'Open a folder before opening a conversation in a new window.':
      'Öffnen Sie einen Ordner, bevor Sie eine Unterhaltung in einem neuen Fenster öffnen.',
  },
  es: {
    'Open Conversation in New Window': 'Abrir la conversación en una ventana nueva',
    'Open a conversation before moving it to a new window.':
      'Abre una conversación antes de moverla a una ventana nueva.',
    'Open a folder before opening a conversation in a new window.':
      'Abre una carpeta antes de abrir una conversación en una ventana nueva.',
  },
  fa: {
    'Open Conversation in New Window': 'باز کردن گفتگو در پنجره جدید',
    'Open a conversation before moving it to a new window.':
      'پیش از انتقال به پنجره جدید، یک گفتگو باز کنید.',
    'Open a folder before opening a conversation in a new window.':
      'پیش از باز کردن گفتگو در پنجره جدید، یک پوشه باز کنید.',
  },
  fr: {
    'Open Conversation in New Window': 'Ouvrir la conversation dans une nouvelle fenêtre',
    'Open a conversation before moving it to a new window.':
      'Ouvrez une conversation avant de la déplacer dans une nouvelle fenêtre.',
    'Open a folder before opening a conversation in a new window.':
      "Ouvrez un dossier avant d'ouvrir une conversation dans une nouvelle fenêtre.",
  },
  hi: {
    'Open Conversation in New Window': 'बातचीत नई विंडो में खोलें',
    'Open a conversation before moving it to a new window.':
      'नई विंडो में ले जाने से पहले कोई बातचीत खोलें।',
    'Open a folder before opening a conversation in a new window.':
      'नई विंडो में बातचीत खोलने से पहले कोई फ़ोल्डर खोलें।',
  },
  it: {
    'Open Conversation in New Window': 'Apri la conversazione in una nuova finestra',
    'Open a conversation before moving it to a new window.':
      'Apri una conversazione prima di spostarla in una nuova finestra.',
    'Open a folder before opening a conversation in a new window.':
      'Apri una cartella prima di aprire una conversazione in una nuova finestra.',
  },
  ja: {
    'Open Conversation in New Window': '会話を新しいウィンドウで開く',
    'Open a conversation before moving it to a new window.':
      '新しいウィンドウに移す前に会話を開いてください。',
    'Open a folder before opening a conversation in a new window.':
      '新しいウィンドウで会話を開く前にフォルダーを開いてください。',
  },
  pt: {
    'Open Conversation in New Window': 'Abrir conversa em nova janela',
    'Open a conversation before moving it to a new window.':
      'Abra uma conversa antes de movê-la para uma nova janela.',
    'Open a folder before opening a conversation in a new window.':
      'Abra uma pasta antes de abrir uma conversa em uma nova janela.',
  },
  ru: {
    'Open Conversation in New Window': 'Открыть беседу в новом окне',
    'Open a conversation before moving it to a new window.':
      'Откройте беседу, прежде чем переносить её в новое окно.',
    'Open a folder before opening a conversation in a new window.':
      'Откройте папку, прежде чем открывать беседу в новом окне.',
  },
  th: {
    'Open Conversation in New Window': 'เปิดการสนทนาในหน้าต่างใหม่',
    'Open a conversation before moving it to a new window.': 'เปิดการสนทนาก่อนย้ายไปหน้าต่างใหม่',
    'Open a folder before opening a conversation in a new window.':
      'เปิดโฟลเดอร์ก่อนเปิดการสนทนาในหน้าต่างใหม่',
  },
  zh: {
    'Open Conversation in New Window': '在新窗口中打开对话',
    'Open a conversation before moving it to a new window.': '请先打开一个对话再移动到新窗口。',
    'Open a folder before opening a conversation in a new window.':
      '在新窗口中打开对话前请先打开一个文件夹。',
  },
};

const threadGroupTranslations = {
  ar: {
    'A short label you will recognise in the sidebar.':
      'تسمية قصيرة ستتعرف عليها في الشريط الجانبي.',
    'Group Conversation': 'تجميع المحادثة',
    'Name the group': 'تسمية المجموعة',
    'New group…': 'مجموعة جديدة…',
    'No group': 'بدون مجموعة',
    'There are no conversations to group.': 'لا توجد محادثات لتجميعها.',
    'Which conversation?': 'أي محادثة؟',
    'Which group?': 'أي مجموعة؟',
  },
  de: {
    'A short label you will recognise in the sidebar.':
      'Eine kurze Bezeichnung, die Sie in der Seitenleiste wiedererkennen.',
    'Group Conversation': 'Unterhaltung gruppieren',
    'Name the group': 'Gruppe benennen',
    'New group…': 'Neue Gruppe…',
    'No group': 'Keine Gruppe',
    'There are no conversations to group.': 'Es gibt keine Unterhaltungen zum Gruppieren.',
    'Which conversation?': 'Welche Unterhaltung?',
    'Which group?': 'Welche Gruppe?',
  },
  es: {
    'A short label you will recognise in the sidebar.':
      'Una etiqueta corta que reconocerás en la barra lateral.',
    'Group Conversation': 'Agrupar conversación',
    'Name the group': 'Nombra el grupo',
    'New group…': 'Grupo nuevo…',
    'No group': 'Sin grupo',
    'There are no conversations to group.': 'No hay conversaciones para agrupar.',
    'Which conversation?': '¿Qué conversación?',
    'Which group?': '¿Qué grupo?',
  },
  fa: {
    'A short label you will recognise in the sidebar.':
      'برچسبی کوتاه که در نوار کناری آن را بشناسید.',
    'Group Conversation': 'گروه‌بندی گفتگو',
    'Name the group': 'نام گروه',
    'New group…': 'گروه جدید…',
    'No group': 'بدون گروه',
    'There are no conversations to group.': 'گفتگویی برای گروه‌بندی وجود ندارد.',
    'Which conversation?': 'کدام گفتگو؟',
    'Which group?': 'کدام گروه؟',
  },
  fr: {
    'A short label you will recognise in the sidebar.':
      'Une courte étiquette que vous reconnaîtrez dans la barre latérale.',
    'Group Conversation': 'Grouper la conversation',
    'Name the group': 'Nommer le groupe',
    'New group…': 'Nouveau groupe…',
    'No group': 'Aucun groupe',
    'There are no conversations to group.': 'Aucune conversation à grouper.',
    'Which conversation?': 'Quelle conversation ?',
    'Which group?': 'Quel groupe ?',
  },
  hi: {
    'A short label you will recognise in the sidebar.':
      'एक छोटा लेबल जिसे आप साइडबार में पहचान लेंगे।',
    'Group Conversation': 'बातचीत समूहित करें',
    'Name the group': 'समूह का नाम दें',
    'New group…': 'नया समूह…',
    'No group': 'कोई समूह नहीं',
    'There are no conversations to group.': 'समूहित करने के लिए कोई बातचीत नहीं है।',
    'Which conversation?': 'कौन सी बातचीत?',
    'Which group?': 'कौन सा समूह?',
  },
  it: {
    'A short label you will recognise in the sidebar.':
      'Una breve etichetta che riconoscerai nella barra laterale.',
    'Group Conversation': 'Raggruppa la conversazione',
    'Name the group': 'Assegna un nome al gruppo',
    'New group…': 'Nuovo gruppo…',
    'No group': 'Nessun gruppo',
    'There are no conversations to group.': 'Non ci sono conversazioni da raggruppare.',
    'Which conversation?': 'Quale conversazione?',
    'Which group?': 'Quale gruppo?',
  },
  ja: {
    'A short label you will recognise in the sidebar.': 'サイドバーで見分けられる短いラベル。',
    'Group Conversation': '会話をグループ化',
    'Name the group': 'グループ名',
    'New group…': '新しいグループ…',
    'No group': 'グループなし',
    'There are no conversations to group.': 'グループ化できる会話はありません。',
    'Which conversation?': 'どの会話ですか？',
    'Which group?': 'どのグループですか？',
  },
  pt: {
    'A short label you will recognise in the sidebar.':
      'Um rótulo curto que você reconhecerá na barra lateral.',
    'Group Conversation': 'Agrupar conversa',
    'Name the group': 'Nomeie o grupo',
    'New group…': 'Novo grupo…',
    'No group': 'Sem grupo',
    'There are no conversations to group.': 'Não há conversas para agrupar.',
    'Which conversation?': 'Qual conversa?',
    'Which group?': 'Qual grupo?',
  },
  ru: {
    'A short label you will recognise in the sidebar.':
      'Короткая метка, которую вы узнаете на боковой панели.',
    'Group Conversation': 'Сгруппировать беседу',
    'Name the group': 'Назовите группу',
    'New group…': 'Новая группа…',
    'No group': 'Без группы',
    'There are no conversations to group.': 'Нет бесед для группировки.',
    'Which conversation?': 'Какая беседа?',
    'Which group?': 'Какая группа?',
  },
  th: {
    'A short label you will recognise in the sidebar.': 'ป้ายสั้น ๆ ที่คุณจะจำได้ในแถบด้านข้าง',
    'Group Conversation': 'จัดกลุ่มการสนทนา',
    'Name the group': 'ตั้งชื่อกลุ่ม',
    'New group…': 'กลุ่มใหม่…',
    'No group': 'ไม่มีกลุ่ม',
    'There are no conversations to group.': 'ไม่มีการสนทนาให้จัดกลุ่ม',
    'Which conversation?': 'การสนทนาใด',
    'Which group?': 'กลุ่มใด',
  },
  zh: {
    'A short label you will recognise in the sidebar.': '你在侧栏中能认出的简短标签。',
    'Group Conversation': '将对话分组',
    'Name the group': '为分组命名',
    'New group…': '新建分组…',
    'No group': '不分组',
    'There are no conversations to group.': '没有可分组的对话。',
    'Which conversation?': '哪个对话？',
    'Which group?': '哪个分组？',
  },
};

const terminalTranslations = {
  ar: {
    'Attach Terminal Output': 'إرفاق مخرجات الطرفية',
    'That terminal has no readable output. Shell integration must be active for ClawAI to read it.':
      'تلك الطرفية ليس لها مخرجات قابلة للقراءة. يجب تفعيل تكامل الصدفة كي يقرأها ClawAI.',
    'There are no open terminals.': 'لا توجد طرفيات مفتوحة.',
    'Which terminal?': 'أي طرفية؟',
  },
  de: {
    'Attach Terminal Output': 'Terminalausgabe anhängen',
    'That terminal has no readable output. Shell integration must be active for ClawAI to read it.':
      'Dieses Terminal hat keine lesbare Ausgabe. Die Shell-Integration muss aktiv sein, damit ClawAI sie lesen kann.',
    'There are no open terminals.': 'Es sind keine Terminals geöffnet.',
    'Which terminal?': 'Welches Terminal?',
  },
  es: {
    'Attach Terminal Output': 'Adjuntar salida del terminal',
    'That terminal has no readable output. Shell integration must be active for ClawAI to read it.':
      'Ese terminal no tiene salida legible. La integración del shell debe estar activa para que ClawAI la lea.',
    'There are no open terminals.': 'No hay terminales abiertos.',
    'Which terminal?': '¿Qué terminal?',
  },
  fa: {
    'Attach Terminal Output': 'پیوست خروجی ترمینال',
    'That terminal has no readable output. Shell integration must be active for ClawAI to read it.':
      'آن ترمینال خروجی قابل خواندن ندارد. برای خواندن، یکپارچگی شل باید فعال باشد.',
    'There are no open terminals.': 'هیچ ترمینال بازی وجود ندارد.',
    'Which terminal?': 'کدام ترمینال؟',
  },
  fr: {
    'Attach Terminal Output': 'Joindre la sortie du terminal',
    'That terminal has no readable output. Shell integration must be active for ClawAI to read it.':
      "Ce terminal n'a pas de sortie lisible. L'intégration du shell doit être active pour que ClawAI la lise.",
    'There are no open terminals.': 'Aucun terminal ouvert.',
    'Which terminal?': 'Quel terminal ?',
  },
  hi: {
    'Attach Terminal Output': 'टर्मिनल आउटपुट संलग्न करें',
    'That terminal has no readable output. Shell integration must be active for ClawAI to read it.':
      'उस टर्मिनल का आउटपुट पढ़ा नहीं जा सकता। ClawAI के पढ़ने के लिए शेल इंटीग्रेशन सक्रिय होना चाहिए।',
    'There are no open terminals.': 'कोई टर्मिनल खुला नहीं है।',
    'Which terminal?': 'कौन सा टर्मिनल?',
  },
  it: {
    'Attach Terminal Output': 'Allega output del terminale',
    'That terminal has no readable output. Shell integration must be active for ClawAI to read it.':
      "Quel terminale non ha output leggibile. L'integrazione della shell deve essere attiva perché ClawAI possa leggerlo.",
    'There are no open terminals.': 'Non ci sono terminali aperti.',
    'Which terminal?': 'Quale terminale?',
  },
  ja: {
    'Attach Terminal Output': 'ターミナル出力を添付',
    'That terminal has no readable output. Shell integration must be active for ClawAI to read it.':
      'そのターミナルには読み取れる出力がありません。ClawAI が読むにはシェル統合が有効である必要があります。',
    'There are no open terminals.': '開いているターミナルはありません。',
    'Which terminal?': 'どのターミナルですか？',
  },
  pt: {
    'Attach Terminal Output': 'Anexar saída do terminal',
    'That terminal has no readable output. Shell integration must be active for ClawAI to read it.':
      'Esse terminal não tem saída legível. A integração do shell precisa estar ativa para o ClawAI ler.',
    'There are no open terminals.': 'Não há terminais abertos.',
    'Which terminal?': 'Qual terminal?',
  },
  ru: {
    'Attach Terminal Output': 'Прикрепить вывод терминала',
    'That terminal has no readable output. Shell integration must be active for ClawAI to read it.':
      'У этого терминала нет читаемого вывода. Для чтения должна быть активна интеграция с оболочкой.',
    'There are no open terminals.': 'Нет открытых терминалов.',
    'Which terminal?': 'Какой терминал?',
  },
  th: {
    'Attach Terminal Output': 'แนบผลลัพธ์จากเทอร์มินัล',
    'That terminal has no readable output. Shell integration must be active for ClawAI to read it.':
      'เทอร์มินัลนั้นไม่มีผลลัพธ์ที่อ่านได้ ต้องเปิดใช้ shell integration เพื่อให้ ClawAI อ่านได้',
    'There are no open terminals.': 'ไม่มีเทอร์มินัลที่เปิดอยู่',
    'Which terminal?': 'เทอร์มินัลใด',
  },
  zh: {
    'Attach Terminal Output': '附加终端输出',
    'That terminal has no readable output. Shell integration must be active for ClawAI to read it.':
      '该终端没有可读取的输出。需要启用 shell 集成，ClawAI 才能读取。',
    'There are no open terminals.': '没有打开的终端。',
    'Which terminal?': '哪个终端？',
  },
};

const sideQuestionTranslations = {
  ar: {
    'Answered outside the conversation, without its context.':
      'تتم الإجابة خارج المحادثة، دون سياقها.',
    'Ask a Side Question': 'طرح سؤال جانبي',
    'Ask a side question': 'اطرح سؤالاً جانبياً',
    'Asking…': 'جارٍ السؤال…',
  },
  de: {
    'Answered outside the conversation, without its context.':
      'Wird außerhalb der Unterhaltung beantwortet, ohne deren Kontext.',
    'Ask a Side Question': 'Nebenfrage stellen',
    'Ask a side question': 'Nebenfrage stellen',
    'Asking…': 'Wird gefragt…',
  },
  es: {
    'Answered outside the conversation, without its context.':
      'Se responde fuera de la conversación, sin su contexto.',
    'Ask a Side Question': 'Hacer una pregunta aparte',
    'Ask a side question': 'Haz una pregunta aparte',
    'Asking…': 'Preguntando…',
  },
  fa: {
    'Answered outside the conversation, without its context.':
      'خارج از گفتگو و بدون زمینه آن پاسخ داده می‌شود.',
    'Ask a Side Question': 'پرسیدن سوال جانبی',
    'Ask a side question': 'یک سوال جانبی بپرسید',
    'Asking…': 'در حال پرسیدن…',
  },
  fr: {
    'Answered outside the conversation, without its context.':
      'Répondu en dehors de la conversation, sans son contexte.',
    'Ask a Side Question': 'Poser une question à part',
    'Ask a side question': 'Poser une question à part',
    'Asking…': 'Question en cours…',
  },
  hi: {
    'Answered outside the conversation, without its context.':
      'बातचीत के बाहर, उसके संदर्भ के बिना उत्तर दिया जाता है।',
    'Ask a Side Question': 'अलग से एक प्रश्न पूछें',
    'Ask a side question': 'अलग से एक प्रश्न पूछें',
    'Asking…': 'पूछा जा रहा है…',
  },
  it: {
    'Answered outside the conversation, without its context.':
      'Risposta fuori dalla conversazione, senza il suo contesto.',
    'Ask a Side Question': 'Fai una domanda a parte',
    'Ask a side question': 'Fai una domanda a parte',
    'Asking…': 'Domanda in corso…',
  },
  ja: {
    'Answered outside the conversation, without its context.':
      '会話の外で、その文脈なしに回答します。',
    'Ask a Side Question': '別の質問をする',
    'Ask a side question': '別の質問をする',
    'Asking…': '質問しています…',
  },
  pt: {
    'Answered outside the conversation, without its context.':
      'Respondido fora da conversa, sem o contexto dela.',
    'Ask a Side Question': 'Fazer uma pergunta à parte',
    'Ask a side question': 'Faça uma pergunta à parte',
    'Asking…': 'Perguntando…',
  },
  ru: {
    'Answered outside the conversation, without its context.':
      'Ответ вне беседы, без её контекста.',
    'Ask a Side Question': 'Задать отдельный вопрос',
    'Ask a side question': 'Задайте отдельный вопрос',
    'Asking…': 'Отправка вопроса…',
  },
  th: {
    'Answered outside the conversation, without its context.':
      'ตอบนอกการสนทนา โดยไม่ใช้บริบทของการสนทนา',
    'Ask a Side Question': 'ถามคำถามแยกต่างหาก',
    'Ask a side question': 'ถามคำถามแยกต่างหาก',
    'Asking…': 'กำลังถาม…',
  },
  zh: {
    'Answered outside the conversation, without its context.': '在对话之外回答，不带对话的上下文。',
    'Ask a Side Question': '提一个旁问',
    'Ask a side question': '提一个旁问',
    'Asking…': '正在提问…',
  },
};

const checkpointTranslations = {
  ar: {
    'Create Checkpoint': 'إنشاء نقطة حفظ',
    'Name this checkpoint': 'تسمية نقطة الحفظ',
    'Restore Checkpoint': 'استعادة نقطة حفظ',
    'Restore which checkpoint?': 'أي نقطة حفظ تريد استعادتها؟',
    'The agent has not changed any files yet, so there is nothing to checkpoint.':
      'لم يغيّر الوكيل أي ملفات بعد، لذا لا يوجد ما يُحفظ.',
    'There are no checkpoints yet.': 'لا توجد نقاط حفظ بعد.',
    'These changes are too large to checkpoint.': 'هذه التغييرات أكبر من أن تُحفظ كنقطة.',
    '{0} files': '{0} ملفات',
    '{0} files will be remembered as they are now.': 'سيتم تذكّر {0} ملفات كما هي الآن.',
  },
  de: {
    'Create Checkpoint': 'Prüfpunkt erstellen',
    'Name this checkpoint': 'Prüfpunkt benennen',
    'Restore Checkpoint': 'Prüfpunkt wiederherstellen',
    'Restore which checkpoint?': 'Welchen Prüfpunkt wiederherstellen?',
    'The agent has not changed any files yet, so there is nothing to checkpoint.':
      'Der Agent hat noch keine Dateien geändert, es gibt also nichts zu sichern.',
    'There are no checkpoints yet.': 'Es gibt noch keine Prüfpunkte.',
    'These changes are too large to checkpoint.':
      'Diese Änderungen sind zu groß für einen Prüfpunkt.',
    '{0} files': '{0} Dateien',
    '{0} files will be remembered as they are now.':
      '{0} Dateien werden so gespeichert, wie sie jetzt sind.',
  },
  es: {
    'Create Checkpoint': 'Crear punto de control',
    'Name this checkpoint': 'Nombra este punto de control',
    'Restore Checkpoint': 'Restaurar punto de control',
    'Restore which checkpoint?': '¿Qué punto de control restaurar?',
    'The agent has not changed any files yet, so there is nothing to checkpoint.':
      'El agente aún no ha cambiado ningún archivo, así que no hay nada que guardar.',
    'There are no checkpoints yet.': 'Aún no hay puntos de control.',
    'These changes are too large to checkpoint.':
      'Estos cambios son demasiado grandes para un punto de control.',
    '{0} files': '{0} archivos',
    '{0} files will be remembered as they are now.':
      'Se recordarán {0} archivos tal como están ahora.',
  },
  fa: {
    'Create Checkpoint': 'ایجاد نقطه بازیابی',
    'Name this checkpoint': 'نام این نقطه بازیابی',
    'Restore Checkpoint': 'بازیابی نقطه بازیابی',
    'Restore which checkpoint?': 'کدام نقطه بازیابی بازگردانده شود؟',
    'The agent has not changed any files yet, so there is nothing to checkpoint.':
      'عامل هنوز فایلی را تغییر نداده است، پس چیزی برای ذخیره وجود ندارد.',
    'There are no checkpoints yet.': 'هنوز نقطه بازیابی وجود ندارد.',
    'These changes are too large to checkpoint.':
      'این تغییرات برای ایجاد نقطه بازیابی بیش از حد بزرگ‌اند.',
    '{0} files': '{0} فایل',
    '{0} files will be remembered as they are now.':
      '{0} فایل به همین شکل کنونی به خاطر سپرده می‌شود.',
  },
  fr: {
    'Create Checkpoint': 'Créer un point de restauration',
    'Name this checkpoint': 'Nommer ce point de restauration',
    'Restore Checkpoint': 'Restaurer un point de restauration',
    'Restore which checkpoint?': 'Quel point de restauration restaurer ?',
    'The agent has not changed any files yet, so there is nothing to checkpoint.':
      "L'agent n'a encore modifié aucun fichier, il n'y a donc rien à enregistrer.",
    'There are no checkpoints yet.': "Il n'y a pas encore de points de restauration.",
    'These changes are too large to checkpoint.':
      'Ces modifications sont trop volumineuses pour un point de restauration.',
    '{0} files': '{0} fichiers',
    '{0} files will be remembered as they are now.': '{0} fichiers seront mémorisés tels quels.',
  },
  hi: {
    'Create Checkpoint': 'चेकपॉइंट बनाएँ',
    'Name this checkpoint': 'इस चेकपॉइंट का नाम दें',
    'Restore Checkpoint': 'चेकपॉइंट पुनर्स्थापित करें',
    'Restore which checkpoint?': 'कौन सा चेकपॉइंट पुनर्स्थापित करें?',
    'The agent has not changed any files yet, so there is nothing to checkpoint.':
      'एजेंट ने अभी तक कोई फ़ाइल नहीं बदली, इसलिए सहेजने को कुछ नहीं है।',
    'There are no checkpoints yet.': 'अभी तक कोई चेकपॉइंट नहीं है।',
    'These changes are too large to checkpoint.': 'ये परिवर्तन चेकपॉइंट के लिए बहुत बड़े हैं।',
    '{0} files': '{0} फ़ाइलें',
    '{0} files will be remembered as they are now.':
      '{0} फ़ाइलें अभी की स्थिति में याद रखी जाएँगी।',
  },
  it: {
    'Create Checkpoint': 'Crea punto di controllo',
    'Name this checkpoint': 'Assegna un nome a questo punto',
    'Restore Checkpoint': 'Ripristina punto di controllo',
    'Restore which checkpoint?': 'Quale punto di controllo ripristinare?',
    'The agent has not changed any files yet, so there is nothing to checkpoint.':
      "L'agente non ha ancora modificato alcun file, quindi non c'è nulla da salvare.",
    'There are no checkpoints yet.': 'Non ci sono ancora punti di controllo.',
    'These changes are too large to checkpoint.':
      'Queste modifiche sono troppo grandi per un punto di controllo.',
    '{0} files': '{0} file',
    '{0} files will be remembered as they are now.': '{0} file verranno ricordati come sono ora.',
  },
  ja: {
    'Create Checkpoint': 'チェックポイントを作成',
    'Name this checkpoint': 'このチェックポイントの名前',
    'Restore Checkpoint': 'チェックポイントを復元',
    'Restore which checkpoint?': 'どのチェックポイントを復元しますか？',
    'The agent has not changed any files yet, so there is nothing to checkpoint.':
      'エージェントはまだファイルを変更していないため、保存するものがありません。',
    'There are no checkpoints yet.': 'まだチェックポイントがありません。',
    'These changes are too large to checkpoint.':
      'この変更はチェックポイントにするには大きすぎます。',
    '{0} files': '{0} 件のファイル',
    '{0} files will be remembered as they are now.': '{0} 件のファイルを現在の状態で記憶します。',
  },
  pt: {
    'Create Checkpoint': 'Criar ponto de restauração',
    'Name this checkpoint': 'Nomeie este ponto de restauração',
    'Restore Checkpoint': 'Restaurar ponto de restauração',
    'Restore which checkpoint?': 'Qual ponto de restauração restaurar?',
    'The agent has not changed any files yet, so there is nothing to checkpoint.':
      'O agente ainda não alterou nenhum arquivo, então não há nada para salvar.',
    'There are no checkpoints yet.': 'Ainda não há pontos de restauração.',
    'These changes are too large to checkpoint.':
      'Estas alterações são grandes demais para um ponto de restauração.',
    '{0} files': '{0} arquivos',
    '{0} files will be remembered as they are now.':
      '{0} arquivos serão lembrados como estao agora.',
  },
  ru: {
    'Create Checkpoint': 'Создать контрольную точку',
    'Name this checkpoint': 'Назовите эту контрольную точку',
    'Restore Checkpoint': 'Восстановить контрольную точку',
    'Restore which checkpoint?': 'Какую контрольную точку восстановить?',
    'The agent has not changed any files yet, so there is nothing to checkpoint.':
      'Агент ещё не изменил ни одного файла, сохранять нечего.',
    'There are no checkpoints yet.': 'Контрольных точек пока нет.',
    'These changes are too large to checkpoint.':
      'Эти изменения слишком велики для контрольной точки.',
    '{0} files': 'Файлов: {0}',
    '{0} files will be remembered as they are now.': 'Файлов будет сохранено в текущем виде: {0}.',
  },
  th: {
    'Create Checkpoint': 'สร้างจุดบันทึก',
    'Name this checkpoint': 'ตั้งชื่อจุดบันทึกนี้',
    'Restore Checkpoint': 'กู้คืนจุดบันทึก',
    'Restore which checkpoint?': 'กู้คืนจุดบันทึกใด',
    'The agent has not changed any files yet, so there is nothing to checkpoint.':
      'เอเจนต์ยังไม่ได้แก้ไขไฟล์ใด จึงไม่มีอะไรให้บันทึก',
    'There are no checkpoints yet.': 'ยังไม่มีจุดบันทึก',
    'These changes are too large to checkpoint.':
      'การเปลี่ยนแปลงเหล่านี้ใหญ่เกินกว่าจะสร้างจุดบันทึก',
    '{0} files': '{0} ไฟล์',
    '{0} files will be remembered as they are now.': 'จะจดจำไฟล์ {0} ไฟล์ตามสถานะปัจจุบัน',
  },
  zh: {
    'Create Checkpoint': '创建检查点',
    'Name this checkpoint': '为该检查点命名',
    'Restore Checkpoint': '恢复检查点',
    'Restore which checkpoint?': '恢复哪个检查点？',
    'The agent has not changed any files yet, so there is nothing to checkpoint.':
      '智能体尚未修改任何文件，没有可保存的内容。',
    'There are no checkpoints yet.': '目前还没有检查点。',
    'These changes are too large to checkpoint.': '这些更改太大，无法创建检查点。',
    '{0} files': '{0} 个文件',
    '{0} files will be remembered as they are now.': '将按当前状态记住 {0} 个文件。',
  },
};

const reasoningVisibilityTranslations = {
  ar: {
    'ClawAI reports how much the model thought, never what it thought.':
      'يعرض ClawAI مقدار تفكير النموذج، لا محتوى ذلك التفكير.',
    '{0} steps · {1} tokens': '{0} خطوات · {1} رمز',
  },
  de: {
    'ClawAI reports how much the model thought, never what it thought.':
      'ClawAI meldet, wie viel das Modell nachgedacht hat, niemals worüber.',
    '{0} steps · {1} tokens': '{0} Schritte · {1} Token',
  },
  es: {
    'ClawAI reports how much the model thought, never what it thought.':
      'ClawAI informa cuánto pensó el modelo, nunca qué pensó.',
    '{0} steps · {1} tokens': '{0} pasos · {1} tokens',
  },
  fa: {
    'ClawAI reports how much the model thought, never what it thought.':
      'ClawAI فقط میزان تفکر مدل را گزارش می‌کند، نه محتوای آن را.',
    '{0} steps · {1} tokens': '{0} گام · {1} توکن',
  },
  fr: {
    'ClawAI reports how much the model thought, never what it thought.':
      'ClawAI indique combien le modèle a réfléchi, jamais à quoi.',
    '{0} steps · {1} tokens': '{0} étapes · {1} jetons',
  },
  hi: {
    'ClawAI reports how much the model thought, never what it thought.':
      'ClawAI बताता है कि मॉडल ने कितना सोचा, यह कभी नहीं कि उसने क्या सोचा।',
    '{0} steps · {1} tokens': '{0} चरण · {1} टोकन',
  },
  it: {
    'ClawAI reports how much the model thought, never what it thought.':
      'ClawAI riporta quanto ha ragionato il modello, mai che cosa ha pensato.',
    '{0} steps · {1} tokens': '{0} passaggi · {1} token',
  },
  ja: {
    'ClawAI reports how much the model thought, never what it thought.':
      'ClawAI はモデルがどれだけ考えたかだけを示し、何を考えたかは示しません。',
    '{0} steps · {1} tokens': '{0} ステップ · {1} トークン',
  },
  pt: {
    'ClawAI reports how much the model thought, never what it thought.':
      'O ClawAI informa quanto o modelo pensou, nunca o que ele pensou.',
    '{0} steps · {1} tokens': '{0} etapas · {1} tokens',
  },
  ru: {
    'ClawAI reports how much the model thought, never what it thought.':
      'ClawAI сообщает, сколько модель размышляла, но никогда — о чём.',
    '{0} steps · {1} tokens': '{0} шагов · {1} токенов',
  },
  th: {
    'ClawAI reports how much the model thought, never what it thought.':
      'ClawAI รายงานว่าโมเดลคิดมากเพียงใด ไม่เคยรายงานว่าคิดอะไร',
    '{0} steps · {1} tokens': '{0} ขั้นตอน · {1} โทเค็น',
  },
  zh: {
    'ClawAI reports how much the model thought, never what it thought.':
      'ClawAI 只报告模型思考了多少，绝不报告它思考了什么。',
    '{0} steps · {1} tokens': '{0} 步 · {1} 个词元',
  },
};

const runTerminalTranslations = {
  ar: {
    'A run is already going. Press Ctrl+C to stop it first.':
      'هناك تشغيل جارٍ بالفعل. اضغط Ctrl+C لإيقافه أولاً.',
    'ClawAI run failed.': 'فشل تشغيل ClawAI.',
    'ClawAI run terminal. Type a request and press Enter. Ctrl+C stops a run.':
      'طرفية تشغيل ClawAI. اكتب طلبك ثم اضغط Enter. Ctrl+C يوقف التشغيل.',
    'Open Run Terminal': 'فتح طرفية التشغيل',
    'Run stopped.': 'تم إيقاف التشغيل.',
  },
  de: {
    'A run is already going. Press Ctrl+C to stop it first.':
      'Es läuft bereits ein Durchlauf. Drücken Sie zuerst Strg+C, um ihn zu stoppen.',
    'ClawAI run failed.': 'ClawAI-Durchlauf fehlgeschlagen.',
    'ClawAI run terminal. Type a request and press Enter. Ctrl+C stops a run.':
      'ClawAI-Ausführungsterminal. Geben Sie eine Anfrage ein und drücken Sie die Eingabetaste. Strg+C stoppt einen Durchlauf.',
    'Open Run Terminal': 'Ausführungsterminal öffnen',
    'Run stopped.': 'Durchlauf gestoppt.',
  },
  es: {
    'A run is already going. Press Ctrl+C to stop it first.':
      'Ya hay una ejecución en curso. Pulsa Ctrl+C para detenerla primero.',
    'ClawAI run failed.': 'La ejecución de ClawAI ha fallado.',
    'ClawAI run terminal. Type a request and press Enter. Ctrl+C stops a run.':
      'Terminal de ejecución de ClawAI. Escribe una petición y pulsa Intro. Ctrl+C detiene una ejecución.',
    'Open Run Terminal': 'Abrir terminal de ejecución',
    'Run stopped.': 'Ejecución detenida.',
  },
  fa: {
    'A run is already going. Press Ctrl+C to stop it first.':
      'یک اجرا در حال انجام است. ابتدا با Ctrl+C آن را متوقف کنید.',
    'ClawAI run failed.': 'اجرای ClawAI ناموفق بود.',
    'ClawAI run terminal. Type a request and press Enter. Ctrl+C stops a run.':
      'پایانه اجرای ClawAI. درخواست خود را بنویسید و Enter را بزنید. Ctrl+C اجرا را متوقف می‌کند.',
    'Open Run Terminal': 'باز کردن پایانه اجرا',
    'Run stopped.': 'اجرا متوقف شد.',
  },
  fr: {
    'A run is already going. Press Ctrl+C to stop it first.':
      'Une exécution est déjà en cours. Appuyez d’abord sur Ctrl+C pour l’arrêter.',
    'ClawAI run failed.': 'L’exécution ClawAI a échoué.',
    'ClawAI run terminal. Type a request and press Enter. Ctrl+C stops a run.':
      'Terminal d’exécution ClawAI. Saisissez une demande et appuyez sur Entrée. Ctrl+C arrête une exécution.',
    'Open Run Terminal': 'Ouvrir le terminal d’exécution',
    'Run stopped.': 'Exécution arrêtée.',
  },
  hi: {
    'A run is already going. Press Ctrl+C to stop it first.':
      'एक रन पहले से चल रहा है। पहले उसे रोकने के लिए Ctrl+C दबाएँ।',
    'ClawAI run failed.': 'ClawAI रन विफल रहा।',
    'ClawAI run terminal. Type a request and press Enter. Ctrl+C stops a run.':
      'ClawAI रन टर्मिनल। अनुरोध लिखें और Enter दबाएँ। Ctrl+C रन रोक देता है।',
    'Open Run Terminal': 'रन टर्मिनल खोलें',
    'Run stopped.': 'रन रोक दिया गया।',
  },
  it: {
    'A run is already going. Press Ctrl+C to stop it first.':
      'Un’esecuzione è già in corso. Premi prima Ctrl+C per interromperla.',
    'ClawAI run failed.': 'Esecuzione ClawAI non riuscita.',
    'ClawAI run terminal. Type a request and press Enter. Ctrl+C stops a run.':
      'Terminale di esecuzione ClawAI. Scrivi una richiesta e premi Invio. Ctrl+C interrompe un’esecuzione.',
    'Open Run Terminal': 'Apri terminale di esecuzione',
    'Run stopped.': 'Esecuzione interrotta.',
  },
  ja: {
    'A run is already going. Press Ctrl+C to stop it first.':
      '実行中のランがあります。まず Ctrl+C で停止してください。',
    'ClawAI run failed.': 'ClawAI の実行に失敗しました。',
    'ClawAI run terminal. Type a request and press Enter. Ctrl+C stops a run.':
      'ClawAI 実行ターミナル。要求を入力して Enter を押してください。Ctrl+C で実行を停止します。',
    'Open Run Terminal': '実行ターミナルを開く',
    'Run stopped.': '実行を停止しました。',
  },
  pt: {
    'A run is already going. Press Ctrl+C to stop it first.':
      'Já há uma execução em andamento. Pressione Ctrl+C para pará-la primeiro.',
    'ClawAI run failed.': 'A execução do ClawAI falhou.',
    'ClawAI run terminal. Type a request and press Enter. Ctrl+C stops a run.':
      'Terminal de execução do ClawAI. Escreva um pedido e pressione Enter. Ctrl+C interrompe uma execução.',
    'Open Run Terminal': 'Abrir terminal de execução',
    'Run stopped.': 'Execução interrompida.',
  },
  ru: {
    'A run is already going. Press Ctrl+C to stop it first.':
      'Запуск уже выполняется. Сначала остановите его клавишами Ctrl+C.',
    'ClawAI run failed.': 'Запуск ClawAI не удался.',
    'ClawAI run terminal. Type a request and press Enter. Ctrl+C stops a run.':
      'Терминал запусков ClawAI. Введите запрос и нажмите Enter. Ctrl+C останавливает запуск.',
    'Open Run Terminal': 'Открыть терминал запусков',
    'Run stopped.': 'Запуск остановлен.',
  },
  th: {
    'A run is already going. Press Ctrl+C to stop it first.':
      'มีการรันอยู่แล้ว กด Ctrl+C เพื่อหยุดก่อน',
    'ClawAI run failed.': 'การรัน ClawAI ล้มเหลว',
    'ClawAI run terminal. Type a request and press Enter. Ctrl+C stops a run.':
      'เทอร์มินัลการรันของ ClawAI พิมพ์คำขอแล้วกด Enter กด Ctrl+C เพื่อหยุดการรัน',
    'Open Run Terminal': 'เปิดเทอร์มินัลการรัน',
    'Run stopped.': 'หยุดการรันแล้ว',
  },
  zh: {
    'A run is already going. Press Ctrl+C to stop it first.':
      '已有运行在进行中。请先按 Ctrl+C 停止。',
    'ClawAI run failed.': 'ClawAI 运行失败。',
    'ClawAI run terminal. Type a request and press Enter. Ctrl+C stops a run.':
      'ClawAI 运行终端。输入请求后按 Enter。按 Ctrl+C 停止运行。',
    'Open Run Terminal': '打开运行终端',
    'Run stopped.': '运行已停止。',
  },
};

const attentionQueueTranslations = {
  ar: {
    'Open chat': 'فتح المحادثة',
    'Finished badly': 'انتهى بشكل سيئ',
    'Needs You': 'يحتاج إليك',
    'Nothing is waiting for you': 'لا شيء بانتظارك',
    'Still going': 'ما زال يعمل',
    'Waiting for an answer': 'بانتظار إجابة',
    'Waiting for approval': 'بانتظار الموافقة',
    'Waiting its turn': 'بانتظار دوره',
    '{0} things are waiting for you': '{0} عناصر بانتظارك',
    '{0} · {1} minutes so far': '{0} · {1} دقيقة حتى الآن',
  },
  de: {
    'Open chat': 'Chat öffnen',
    'Finished badly': 'Schlecht geendet',
    'Needs You': 'Braucht Sie',
    'Nothing is waiting for you': 'Nichts wartet auf Sie',
    'Still going': 'Läuft noch',
    'Waiting for an answer': 'Wartet auf eine Antwort',
    'Waiting for approval': 'Wartet auf Genehmigung',
    'Waiting its turn': 'Wartet auf seinen Platz',
    '{0} things are waiting for you': '{0} Dinge warten auf Sie',
    '{0} · {1} minutes so far': '{0} · bisher {1} Minuten',
  },
  es: {
    'Open chat': 'Abrir chat',
    'Finished badly': 'Terminó mal',
    'Needs You': 'Te necesita',
    'Nothing is waiting for you': 'Nada te está esperando',
    'Still going': 'Todavía en curso',
    'Waiting for an answer': 'Esperando una respuesta',
    'Waiting for approval': 'Esperando aprobación',
    'Waiting its turn': 'Esperando su turno',
    '{0} things are waiting for you': '{0} cosas te están esperando',
    '{0} · {1} minutes so far': '{0} · {1} minutos hasta ahora',
  },
  fa: {
    'Open chat': 'باز کردن گفتگو',
    'Finished badly': 'با شکست پایان یافت',
    'Needs You': 'به شما نیاز دارد',
    'Nothing is waiting for you': 'چیزی در انتظار شما نیست',
    'Still going': 'هنوز در حال اجرا',
    'Waiting for an answer': 'در انتظار پاسخ',
    'Waiting for approval': 'در انتظار تأیید',
    'Waiting its turn': 'در انتظار نوبت',
    '{0} things are waiting for you': '{0} مورد در انتظار شماست',
    '{0} · {1} minutes so far': '{0} · تاکنون {1} دقیقه',
  },
  fr: {
    'Open chat': 'Ouvrir le chat',
    'Finished badly': 'S’est mal terminé',
    'Needs You': 'Requiert votre attention',
    'Nothing is waiting for you': 'Rien ne vous attend',
    'Still going': 'Toujours en cours',
    'Waiting for an answer': 'En attente d’une réponse',
    'Waiting for approval': 'En attente d’approbation',
    'Waiting its turn': 'Attend son tour',
    '{0} things are waiting for you': '{0} éléments vous attendent',
    '{0} · {1} minutes so far': '{0} · {1} minutes jusqu’ici',
  },
  hi: {
    'Open chat': 'चैट खोलें',
    'Finished badly': 'गड़बड़ी के साथ समाप्त',
    'Needs You': 'आपकी ज़रूरत है',
    'Nothing is waiting for you': 'कुछ भी आपका इंतज़ार नहीं कर रहा',
    'Still going': 'अब भी चल रहा है',
    'Waiting for an answer': 'उत्तर की प्रतीक्षा में',
    'Waiting for approval': 'अनुमोदन की प्रतीक्षा में',
    'Waiting its turn': 'अपनी बारी की प्रतीक्षा में',
    '{0} things are waiting for you': '{0} चीज़ें आपका इंतज़ार कर रही हैं',
    '{0} · {1} minutes so far': '{0} · अब तक {1} मिनट',
  },
  it: {
    'Open chat': 'Apri chat',
    'Finished badly': 'Finito male',
    'Needs You': 'Richiede la tua attenzione',
    'Nothing is waiting for you': 'Nulla ti sta aspettando',
    'Still going': 'Ancora in corso',
    'Waiting for an answer': 'In attesa di una risposta',
    'Waiting for approval': 'In attesa di approvazione',
    'Waiting its turn': 'In attesa del proprio turno',
    '{0} things are waiting for you': '{0} elementi ti stanno aspettando',
    '{0} · {1} minutes so far': '{0} · {1} minuti finora',
  },
  ja: {
    'Open chat': 'チャットを開く',
    'Finished badly': '失敗して終了',
    'Needs You': '要対応',
    'Nothing is waiting for you': '待っているものはありません',
    'Still going': '実行中',
    'Waiting for an answer': '回答待ち',
    'Waiting for approval': '承認待ち',
    'Waiting its turn': '順番待ち',
    '{0} things are waiting for you': '{0} 件があなたを待っています',
    '{0} · {1} minutes so far': '{0} · これまで {1} 分',
  },
  pt: {
    'Open chat': 'Abrir chat',
    'Finished badly': 'Terminou mal',
    'Needs You': 'Precisa de você',
    'Nothing is waiting for you': 'Nada está esperando por você',
    'Still going': 'Ainda em andamento',
    'Waiting for an answer': 'Aguardando uma resposta',
    'Waiting for approval': 'Aguardando aprovação',
    'Waiting its turn': 'Aguardando sua vez',
    '{0} things are waiting for you': '{0} itens estão esperando por você',
    '{0} · {1} minutes so far': '{0} · {1} minutos até agora',
  },
  ru: {
    'Open chat': 'Открыть чат',
    'Finished badly': 'Завершилось неудачно',
    'Needs You': 'Требует вас',
    'Nothing is waiting for you': 'Вас ничто не ждёт',
    'Still going': 'Ещё выполняется',
    'Waiting for an answer': 'Ожидает ответа',
    'Waiting for approval': 'Ожидает подтверждения',
    'Waiting its turn': 'Ожидает очереди',
    '{0} things are waiting for you': '{0} элементов ждут вас',
    '{0} · {1} minutes so far': '{0} · {1} мин. на данный момент',
  },
  th: {
    'Open chat': 'เปิดแชต',
    'Finished badly': 'จบลงไม่ดี',
    'Needs You': 'ต้องการคุณ',
    'Nothing is waiting for you': 'ไม่มีอะไรรอคุณอยู่',
    'Still going': 'ยังทำงานอยู่',
    'Waiting for an answer': 'รอคำตอบ',
    'Waiting for approval': 'รอการอนุมัติ',
    'Waiting its turn': 'รอคิว',
    '{0} things are waiting for you': 'มี {0} รายการรอคุณอยู่',
    '{0} · {1} minutes so far': '{0} · {1} นาทีจนถึงตอนนี้',
  },
  zh: {
    'Open chat': '打开聊天',
    'Finished badly': '结束得不顺利',
    'Needs You': '需要你处理',
    'Nothing is waiting for you': '没有等你处理的事项',
    'Still going': '仍在进行',
    'Waiting for an answer': '等待回答',
    'Waiting for approval': '等待批准',
    'Waiting its turn': '排队等待',
    '{0} things are waiting for you': '有 {0} 项在等你处理',
    '{0} · {1} minutes so far': '{0} · 目前已 {1} 分钟',
  },
};

const routingStrategyTranslations = {
  ar: {
    'Fastest reply': 'أسرع رد',
    'How the backend picks a model: automatic, a named strategy, or one you select yourself.':
      'كيف تختار الخدمة الخلفية النموذج: تلقائيًا، أو باستراتيجية مسماة، أو نموذج تختاره بنفسك.',
    'Local models only': 'النماذج المحلية فقط',
    'Lowest cost': 'أقل تكلفة',
    'Privacy first': 'الخصوصية أولاً',
    'Strongest reasoning': 'أقوى استدلال',
    'The selected model cannot call tools, so an agent run will not edit files.':
      'النموذج المحدد لا يستطيع استدعاء الأدوات، لذا لن يعدّل تشغيل الوكيل أي ملفات.',
  },
  de: {
    'Fastest reply': 'Schnellste Antwort',
    'How the backend picks a model: automatic, a named strategy, or one you select yourself.':
      'Wie das Backend ein Modell wählt: automatisch, nach benannter Strategie oder von Ihnen selbst gewählt.',
    'Local models only': 'Nur lokale Modelle',
    'Lowest cost': 'Geringste Kosten',
    'Privacy first': 'Datenschutz zuerst',
    'Strongest reasoning': 'Stärkstes Reasoning',
    'The selected model cannot call tools, so an agent run will not edit files.':
      'Das gewählte Modell kann keine Tools aufrufen, daher ändert ein Agentenlauf keine Dateien.',
  },
  es: {
    'Fastest reply': 'Respuesta más rápida',
    'How the backend picks a model: automatic, a named strategy, or one you select yourself.':
      'Cómo elige el backend un modelo: automáticamente, con una estrategia con nombre o uno que elijas tú.',
    'Local models only': 'Solo modelos locales',
    'Lowest cost': 'Menor coste',
    'Privacy first': 'Privacidad primero',
    'Strongest reasoning': 'Razonamiento más potente',
    'The selected model cannot call tools, so an agent run will not edit files.':
      'El modelo seleccionado no puede llamar a herramientas, así que una ejecución del agente no editará archivos.',
  },
  fa: {
    'Fastest reply': 'سریع‌ترین پاسخ',
    'How the backend picks a model: automatic, a named strategy, or one you select yourself.':
      'روش انتخاب مدل توسط بک‌اند: خودکار، یک راهبرد نام‌گذاری‌شده، یا مدلی که خودتان انتخاب می‌کنید.',
    'Local models only': 'فقط مدل‌های محلی',
    'Lowest cost': 'کمترین هزینه',
    'Privacy first': 'حریم خصوصی در اولویت',
    'Strongest reasoning': 'قوی‌ترین استدلال',
    'The selected model cannot call tools, so an agent run will not edit files.':
      'مدل انتخاب‌شده نمی‌تواند ابزارها را فراخوانی کند، بنابراین اجرای عامل هیچ فایلی را ویرایش نمی‌کند.',
  },
  fr: {
    'Fastest reply': 'Réponse la plus rapide',
    'How the backend picks a model: automatic, a named strategy, or one you select yourself.':
      'Comment le backend choisit un modèle : automatiquement, selon une stratégie nommée, ou celui que vous choisissez.',
    'Local models only': 'Modèles locaux uniquement',
    'Lowest cost': 'Coût le plus bas',
    'Privacy first': 'Confidentialité d’abord',
    'Strongest reasoning': 'Raisonnement le plus puissant',
    'The selected model cannot call tools, so an agent run will not edit files.':
      'Le modèle sélectionné ne peut pas appeler d’outils, donc une exécution de l’agent ne modifiera aucun fichier.',
  },
  hi: {
    'Fastest reply': 'सबसे तेज़ उत्तर',
    'How the backend picks a model: automatic, a named strategy, or one you select yourself.':
      'बैकएंड मॉडल कैसे चुनता है: स्वचालित रूप से, किसी नामित रणनीति से, या आपके द्वारा चुना गया।',
    'Local models only': 'केवल स्थानीय मॉडल',
    'Lowest cost': 'सबसे कम लागत',
    'Privacy first': 'गोपनीयता पहले',
    'Strongest reasoning': 'सबसे मज़बूत तर्क',
    'The selected model cannot call tools, so an agent run will not edit files.':
      'चयनित मॉडल टूल नहीं बुला सकता, इसलिए एजेंट रन कोई फ़ाइल संपादित नहीं करेगा।',
  },
  it: {
    'Fastest reply': 'Risposta più rapida',
    'How the backend picks a model: automatic, a named strategy, or one you select yourself.':
      'Come il backend sceglie un modello: automaticamente, con una strategia denominata o uno scelto da te.',
    'Local models only': 'Solo modelli locali',
    'Lowest cost': 'Costo più basso',
    'Privacy first': 'Privacy prima di tutto',
    'Strongest reasoning': 'Ragionamento più forte',
    'The selected model cannot call tools, so an agent run will not edit files.':
      'Il modello selezionato non può chiamare strumenti, quindi un’esecuzione dell’agente non modificherà file.',
  },
  ja: {
    'Fastest reply': '最速の応答',
    'How the backend picks a model: automatic, a named strategy, or one you select yourself.':
      'バックエンドがモデルを選ぶ方法: 自動、名前付き戦略、または自分で選択。',
    'Local models only': 'ローカルモデルのみ',
    'Lowest cost': '最低コスト',
    'Privacy first': 'プライバシー優先',
    'Strongest reasoning': '最も強力な推論',
    'The selected model cannot call tools, so an agent run will not edit files.':
      '選択したモデルはツールを呼び出せないため、エージェント実行はファイルを編集しません。',
  },
  pt: {
    'Fastest reply': 'Resposta mais rápida',
    'How the backend picks a model: automatic, a named strategy, or one you select yourself.':
      'Como o backend escolhe um modelo: automaticamente, por uma estratégia nomeada ou um que você escolha.',
    'Local models only': 'Apenas modelos locais',
    'Lowest cost': 'Menor custo',
    'Privacy first': 'Privacidade em primeiro lugar',
    'Strongest reasoning': 'Raciocínio mais forte',
    'The selected model cannot call tools, so an agent run will not edit files.':
      'O modelo selecionado não pode chamar ferramentas, portanto uma execução do agente não editará arquivos.',
  },
  ru: {
    'Fastest reply': 'Самый быстрый ответ',
    'How the backend picks a model: automatic, a named strategy, or one you select yourself.':
      'Как бэкенд выбирает модель: автоматически, по названной стратегии или по вашему выбору.',
    'Local models only': 'Только локальные модели',
    'Lowest cost': 'Наименьшая стоимость',
    'Privacy first': 'Приоритет конфиденциальности',
    'Strongest reasoning': 'Самое сильное рассуждение',
    'The selected model cannot call tools, so an agent run will not edit files.':
      'Выбранная модель не может вызывать инструменты, поэтому запуск агента не изменит файлы.',
  },
  th: {
    'Fastest reply': 'ตอบเร็วที่สุด',
    'How the backend picks a model: automatic, a named strategy, or one you select yourself.':
      'วิธีที่แบ็กเอนด์เลือกโมเดล: อัตโนมัติ กลยุทธ์ที่ระบุชื่อ หรือโมเดลที่คุณเลือกเอง',
    'Local models only': 'เฉพาะโมเดลในเครื่อง',
    'Lowest cost': 'ต้นทุนต่ำสุด',
    'Privacy first': 'ความเป็นส่วนตัวมาก่อน',
    'Strongest reasoning': 'การให้เหตุผลที่แข็งแกร่งที่สุด',
    'The selected model cannot call tools, so an agent run will not edit files.':
      'โมเดลที่เลือกเรียกใช้เครื่องมือไม่ได้ การรันเอเจนต์จึงจะไม่แก้ไขไฟล์',
  },
  zh: {
    'Fastest reply': '最快回复',
    'How the backend picks a model: automatic, a named strategy, or one you select yourself.':
      '后端如何选择模型：自动、指定策略，或由你自己选择。',
    'Local models only': '仅本地模型',
    'Lowest cost': '成本最低',
    'Privacy first': '隐私优先',
    'Strongest reasoning': '最强推理',
    'The selected model cannot call tools, so an agent run will not edit files.':
      '所选模型无法调用工具，因此智能体运行不会修改任何文件。',
  },
};

const autoCompactionTranslations = {
  ar: {
    'What to do when a conversation is nearly too long to continue: nothing, offer to summarize it, or summarize it automatically.':
      'ما الذي يحدث عندما تقترب المحادثة من الطول الأقصى: لا شيء، أو عرض تلخيصها، أو تلخيصها تلقائيًا.',
  },
  de: {
    'What to do when a conversation is nearly too long to continue: nothing, offer to summarize it, or summarize it automatically.':
      'Was geschehen soll, wenn eine Unterhaltung fast zu lang zum Fortsetzen ist: nichts, eine Zusammenfassung anbieten oder automatisch zusammenfassen.',
  },
  es: {
    'What to do when a conversation is nearly too long to continue: nothing, offer to summarize it, or summarize it automatically.':
      'Qué hacer cuando una conversación está casi demasiado larga para continuar: nada, ofrecer resumirla o resumirla automáticamente.',
  },
  fa: {
    'What to do when a conversation is nearly too long to continue: nothing, offer to summarize it, or summarize it automatically.':
      'وقتی گفتگو تقریباً برای ادامه بیش از حد طولانی شد چه کند: هیچ کاری، پیشنهاد خلاصه‌سازی، یا خلاصه‌سازی خودکار.',
  },
  fr: {
    'What to do when a conversation is nearly too long to continue: nothing, offer to summarize it, or summarize it automatically.':
      'Que faire lorsqu’une conversation devient trop longue pour continuer : rien, proposer de la résumer, ou la résumer automatiquement.',
  },
  hi: {
    'What to do when a conversation is nearly too long to continue: nothing, offer to summarize it, or summarize it automatically.':
      'जब बातचीत जारी रखने के लिए लगभग बहुत लंबी हो जाए तो क्या करें: कुछ नहीं, सारांश बनाने का प्रस्ताव दें, या स्वतः सारांश बनाएँ।',
  },
  it: {
    'What to do when a conversation is nearly too long to continue: nothing, offer to summarize it, or summarize it automatically.':
      'Cosa fare quando una conversazione è quasi troppo lunga per continuare: niente, proporre di riassumerla o riassumerla automaticamente.',
  },
  ja: {
    'What to do when a conversation is nearly too long to continue: nothing, offer to summarize it, or summarize it automatically.':
      '会話が続けるには長くなりすぎそうなときの動作: 何もしない、要約を提案する、または自動的に要約する。',
  },
  pt: {
    'What to do when a conversation is nearly too long to continue: nothing, offer to summarize it, or summarize it automatically.':
      'O que fazer quando uma conversa fica quase longa demais para continuar: nada, oferecer resumi-la ou resumi-la automaticamente.',
  },
  ru: {
    'What to do when a conversation is nearly too long to continue: nothing, offer to summarize it, or summarize it automatically.':
      'Что делать, когда беседа почти слишком длинная для продолжения: ничего, предложить сократить её или сокращать автоматически.',
  },
  th: {
    'What to do when a conversation is nearly too long to continue: nothing, offer to summarize it, or summarize it automatically.':
      'จะทำอย่างไรเมื่อการสนทนายาวเกินกว่าจะดำเนินต่อ: ไม่ทำอะไร เสนอให้สรุป หรือสรุปโดยอัตโนมัติ',
  },
  zh: {
    'What to do when a conversation is nearly too long to continue: nothing, offer to summarize it, or summarize it automatically.':
      '当对话长到几乎无法继续时的处理方式：不处理、提示是否总结，或自动总结。',
  },
};

const contextFreshnessTranslations = {
  ar: {
    'changed since it was read': 'تغيّر منذ قراءته',
    'no longer there': 'لم يعد موجودًا',
  },
  de: {
    'changed since it was read': 'seit dem Lesen geändert',
    'no longer there': 'nicht mehr vorhanden',
  },
  es: {
    'changed since it was read': 'cambiado desde que se leyó',
    'no longer there': 'ya no existe',
  },
  fa: {
    'changed since it was read': 'از زمان خواندن تغییر کرده',
    'no longer there': 'دیگر وجود ندارد',
  },
  fr: {
    'changed since it was read': 'modifié depuis sa lecture',
    'no longer there': 'n’existe plus',
  },
  hi: {
    'changed since it was read': 'पढ़े जाने के बाद बदला',
    'no longer there': 'अब मौजूद नहीं',
  },
  it: {
    'changed since it was read': 'modificato da quando è stato letto',
    'no longer there': 'non esiste più',
  },
  ja: {
    'changed since it was read': '読み取り後に変更されました',
    'no longer there': 'すでに存在しません',
  },
  pt: {
    'changed since it was read': 'alterado desde que foi lido',
    'no longer there': 'já não existe',
  },
  ru: {
    'changed since it was read': 'изменено после чтения',
    'no longer there': 'больше не существует',
  },
  th: {
    'changed since it was read': 'เปลี่ยนแปลงหลังจากถูกอ่าน',
    'no longer there': 'ไม่มีอยู่แล้ว',
  },
  zh: {
    'changed since it was read': '读取后已更改',
    'no longer there': '已不存在',
  },
};

const fastModeTranslations = {
  ar: {
    'Fast mode is off.': 'الوضع السريع متوقف.',
    'Fast mode is on: the router prefers a quick model and context is gathered 2X.':
      'الوضع السريع مُفعّل: يفضّل الموجّه نموذجًا سريعًا ويُجمع السياق بسرعة 2X.',
    'Toggle Fast Mode': 'تبديل الوضع السريع',
  },
  de: {
    'Fast mode is off.': 'Schnellmodus ist aus.',
    'Fast mode is on: the router prefers a quick model and context is gathered 2X.':
      'Schnellmodus ist an: Der Router bevorzugt ein schnelles Modell und der Kontext wird mit 2X erfasst.',
    'Toggle Fast Mode': 'Schnellmodus umschalten',
  },
  es: {
    'Fast mode is off.': 'El modo rápido está desactivado.',
    'Fast mode is on: the router prefers a quick model and context is gathered 2X.':
      'El modo rápido está activado: el enrutador prefiere un modelo rápido y el contexto se recopila a 2X.',
    'Toggle Fast Mode': 'Alternar modo rápido',
  },
  fa: {
    'Fast mode is off.': 'حالت سریع خاموش است.',
    'Fast mode is on: the router prefers a quick model and context is gathered 2X.':
      'حالت سریع روشن است: مسیریاب مدلی سریع را ترجیح می‌دهد و زمینه با سرعت 2X جمع‌آوری می‌شود.',
    'Toggle Fast Mode': 'تغییر وضعیت حالت سریع',
  },
  fr: {
    'Fast mode is off.': 'Le mode rapide est désactivé.',
    'Fast mode is on: the router prefers a quick model and context is gathered 2X.':
      'Le mode rapide est activé : le routeur préfère un modèle rapide et le contexte est collecté en 2X.',
    'Toggle Fast Mode': 'Basculer le mode rapide',
  },
  hi: {
    'Fast mode is off.': 'फ़ास्ट मोड बंद है।',
    'Fast mode is on: the router prefers a quick model and context is gathered 2X.':
      'फ़ास्ट मोड चालू है: राउटर तेज़ मॉडल पसंद करता है और संदर्भ 2X पर एकत्र होता है।',
    'Toggle Fast Mode': 'फ़ास्ट मोड टॉगल करें',
  },
  it: {
    'Fast mode is off.': 'La modalità rapida è disattivata.',
    'Fast mode is on: the router prefers a quick model and context is gathered 2X.':
      'La modalità rapida è attiva: il router preferisce un modello veloce e il contesto viene raccolto a 2X.',
    'Toggle Fast Mode': 'Attiva/disattiva modalità rapida',
  },
  ja: {
    'Fast mode is off.': '高速モードはオフです。',
    'Fast mode is on: the router prefers a quick model and context is gathered 2X.':
      '高速モードがオンです: ルーターは速いモデルを優先し、コンテキストは 2X で収集されます。',
    'Toggle Fast Mode': '高速モードの切り替え',
  },
  pt: {
    'Fast mode is off.': 'O modo rápido está desativado.',
    'Fast mode is on: the router prefers a quick model and context is gathered 2X.':
      'O modo rápido está ativado: o roteador prefere um modelo rápido e o contexto é coletado a 2X.',
    'Toggle Fast Mode': 'Alternar modo rápido',
  },
  ru: {
    'Fast mode is off.': 'Быстрый режим выключен.',
    'Fast mode is on: the router prefers a quick model and context is gathered 2X.':
      'Быстрый режим включён: маршрутизатор предпочитает быструю модель, а контекст собирается на 2X.',
    'Toggle Fast Mode': 'Переключить быстрый режим',
  },
  th: {
    'Fast mode is off.': 'โหมดเร็วปิดอยู่',
    'Fast mode is on: the router prefers a quick model and context is gathered 2X.':
      'โหมดเร็วเปิดอยู่: ตัวจัดเส้นทางจะเลือกโมเดลที่เร็วและเก็บบริบทที่ 2X',
    'Toggle Fast Mode': 'สลับโหมดเร็ว',
  },
  zh: {
    'Fast mode is off.': '快速模式已关闭。',
    'Fast mode is on: the router prefers a quick model and context is gathered 2X.':
      '快速模式已开启：路由器优先选择快速模型，并以 2X 收集上下文。',
    'Toggle Fast Mode': '切换快速模式',
  },
};

const browserOriginTranslations = {
  ar: {
    'Extra site origins the browser tool may open without asking, such as your own development server. The backend and frontend origins are always allowed and cannot be removed here.':
      'أصول مواقع إضافية يمكن لأداة المتصفح فتحها دون سؤال، مثل خادم التطوير الخاص بك. أصل الخدمة الخلفية والواجهة مسموح بها دائمًا ولا يمكن إزالتها هنا.',
  },
  de: {
    'Extra site origins the browser tool may open without asking, such as your own development server. The backend and frontend origins are always allowed and cannot be removed here.':
      'Zusätzliche Website-Origins, die das Browser-Tool ohne Nachfrage öffnen darf, etwa Ihr eigener Entwicklungsserver. Die Backend- und Frontend-Origins sind immer erlaubt und lassen sich hier nicht entfernen.',
  },
  es: {
    'Extra site origins the browser tool may open without asking, such as your own development server. The backend and frontend origins are always allowed and cannot be removed here.':
      'Orígenes de sitios adicionales que la herramienta de navegador puede abrir sin preguntar, como tu propio servidor de desarrollo. Los orígenes del backend y del frontend siempre están permitidos y no pueden quitarse aquí.',
  },
  fa: {
    'Extra site origins the browser tool may open without asking, such as your own development server. The backend and frontend origins are always allowed and cannot be removed here.':
      'مبدأهای سایت اضافی که ابزار مرورگر می‌تواند بدون پرسش باز کند، مانند سرور توسعه خودتان. مبدأ بک‌اند و فرانت‌اند همیشه مجاز است و از اینجا حذف نمی‌شود.',
  },
  fr: {
    'Extra site origins the browser tool may open without asking, such as your own development server. The backend and frontend origins are always allowed and cannot be removed here.':
      'Origines de sites supplémentaires que l’outil de navigation peut ouvrir sans demander, comme votre propre serveur de développement. Les origines backend et frontend sont toujours autorisées et ne peuvent pas être retirées ici.',
  },
  hi: {
    'Extra site origins the browser tool may open without asking, such as your own development server. The backend and frontend origins are always allowed and cannot be removed here.':
      'अतिरिक्त साइट ऑरिजिन जिन्हें ब्राउज़र टूल बिना पूछे खोल सकता है, जैसे आपका अपना डेवलपमेंट सर्वर। बैकएंड और फ़्रंटएंड ऑरिजिन हमेशा अनुमत हैं और यहाँ से हटाए नहीं जा सकते।',
  },
  it: {
    'Extra site origins the browser tool may open without asking, such as your own development server. The backend and frontend origins are always allowed and cannot be removed here.':
      'Origini di siti aggiuntive che lo strumento browser può aprire senza chiedere, come il tuo server di sviluppo. Le origini di backend e frontend sono sempre consentite e non possono essere rimosse qui.',
  },
  ja: {
    'Extra site origins the browser tool may open without asking, such as your own development server. The backend and frontend origins are always allowed and cannot be removed here.':
      'ブラウザーツールが確認なしに開いてよい追加のサイトオリジン（自分の開発サーバーなど）。バックエンドとフロントエンドのオリジンは常に許可され、ここでは削除できません。',
  },
  pt: {
    'Extra site origins the browser tool may open without asking, such as your own development server. The backend and frontend origins are always allowed and cannot be removed here.':
      'Origens de sites adicionais que a ferramenta de navegador pode abrir sem perguntar, como o seu próprio servidor de desenvolvimento. As origens do backend e do frontend são sempre permitidas e não podem ser removidas aqui.',
  },
  ru: {
    'Extra site origins the browser tool may open without asking, such as your own development server. The backend and frontend origins are always allowed and cannot be removed here.':
      'Дополнительные источники сайтов, которые инструмент браузера может открывать без запроса, например ваш собственный сервер разработки. Источники бэкенда и фронтенда разрешены всегда и здесь не удаляются.',
  },
  th: {
    'Extra site origins the browser tool may open without asking, such as your own development server. The backend and frontend origins are always allowed and cannot be removed here.':
      'ออริจินของเว็บไซต์เพิ่มเติมที่เครื่องมือเบราว์เซอร์เปิดได้โดยไม่ต้องถาม เช่น เซิร์ฟเวอร์สำหรับพัฒนาของคุณเอง ออริจินของแบ็กเอนด์และฟรอนต์เอนด์ได้รับอนุญาตเสมอและลบที่นี่ไม่ได้',
  },
  zh: {
    'Extra site origins the browser tool may open without asking, such as your own development server. The backend and frontend origins are always allowed and cannot be removed here.':
      '浏览器工具无需询问即可打开的额外站点来源，例如你自己的开发服务器。后端和前端来源始终被允许，且无法在此移除。',
  },
};

function translate(locale, message) {
  return (
    statusLineTranslations[locale][message] ??
    turnNavigationTranslations[locale][message] ??
    onboardingTranslations[locale][message] ??
    focusViewTranslations[locale][message] ??
    threadOrganizationTranslations[locale][message] ??
    sessionTabTranslations[locale][message] ??
    mentionTranslations[locale][message] ??
    composerTranslations[locale][message] ??
    administratorTranslations[locale][message] ??
    runtimeV2Translations[locale][message] ??
    environmentTranslations[locale][message] ??
    cockpitTranslations[locale][message] ??
    v090Translations[locale][message] ??
    continuityTranslations[locale][message] ??
    releaseTranslations[locale][message] ??
    routineApprovalTranslations[locale][message] ??
    exactTranslations[locale][message] ??
    checkpointTranslations[locale][message] ??
    sideQuestionTranslations[locale][message] ??
    terminalTranslations[locale][message] ??
    threadGroupTranslations[locale][message] ??
    newWindowTranslations[locale][message] ??
    compactionTranslations[locale][message] ??
    contextWarningTranslations[locale][message] ??
    attachmentTranslations[locale][message] ??
    settingDescriptionTranslations[locale][message] ??
    outputStyleTranslations[locale][message] ??
    sharedTranslations[locale][message] ??
    coreSurfaceTranslations[locale][message] ??
    reasoningVisibilityTranslations[locale][message] ??
    runTerminalTranslations[locale][message] ??
    attentionQueueTranslations[locale][message] ??
    routingStrategyTranslations[locale][message] ??
    autoCompactionTranslations[locale][message] ??
    contextFreshnessTranslations[locale][message] ??
    fastModeTranslations[locale][message] ??
    browserOriginTranslations[locale][message] ??
    message
  );
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

const englishPackage = JSON.parse(readFileSync(join(root, 'package.nls.json'), 'utf8'));
const runtime = runtimeMessages();
mkdirSync(join(root, 'l10n'), { recursive: true });
writeJson(
  join(root, 'l10n', 'bundle.l10n.json'),
  Object.fromEntries(runtime.map((message) => [message, message])),
);

for (const locale of Object.keys(localeNames)) {
  const packageMessages = {};
  for (const [key, value] of Object.entries(englishPackage)) {
    const source = packageKeyTranslations[key] ?? value;
    packageMessages[key] = translate(locale, source);
  }
  writeJson(join(root, `package.nls.${locale}.json`), packageMessages);
  writeJson(
    join(root, 'l10n', `bundle.l10n.${locale}.json`),
    Object.fromEntries(runtime.map((message) => [message, translate(locale, message)])),
  );
}

stdout.write(
  `Generated ${String(Object.keys(localeNames).length)} locale pairs with ${String(runtime.length)} runtime messages from ${relative(root, join(root, 'src'))}.\n`,
);
