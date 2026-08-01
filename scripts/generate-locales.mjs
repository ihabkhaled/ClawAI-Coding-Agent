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

function translate(locale, message) {
  return (
    cockpitTranslations[locale][message] ??
    v090Translations[locale][message] ??
    continuityTranslations[locale][message] ??
    releaseTranslations[locale][message] ??
    routineApprovalTranslations[locale][message] ??
    exactTranslations[locale][message] ??
    sharedTranslations[locale][message] ??
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
