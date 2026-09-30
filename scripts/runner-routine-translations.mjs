// F099 prompt routines and F100 runner approval policy.
export const runnerRoutineTranslations = {
  ar: {
    'A routine prompt must be 1 to 8000 characters.':
      'يجب أن يتكون موجّه الروتين من 1 إلى 8000 حرف.',
    'A model reference must be at most 128 characters.': 'يجب ألا يتجاوز مرجع النموذج 128 حرفًا.',
    'The repository must be a workspace folder name, not a path.':
      'يجب أن يكون المستودع اسم مجلد في مساحة العمل، وليس مسارًا.',
    'Runner labels are up to 16 lower-case names of letters, digits, dots, dashes or underscores.':
      'تسميات المُشغّل حتى 16 اسمًا بأحرف صغيرة من الحروف والأرقام والنقاط والشرطات أو الشرطات السفلية.',
    'Shell command on a paired device': 'أمر طرفية على جهاز مقترن',
    'Agent prompt on a runner': 'موجّه وكيل على مُشغّل',
    'Runs on an online runner with matching labels, even while this editor is closed.':
      'يعمل على مُشغّل متصل بتسميات مطابقة، حتى أثناء إغلاق هذا المحرر.',
    'What should the routine run?': 'ماذا يجب أن يشغّل الروتين؟',
    'Prompt the runner sends to the agent': 'الموجّه الذي يرسله المُشغّل إلى الوكيل',
    'Model as PROVIDER/model, for example GEMINI/gemini-2.5-flash (optional)':
      'النموذج بصيغة PROVIDER/model، مثل GEMINI/gemini-2.5-flash (اختياري)',
    'Workspace folder name the runner must have open (optional)':
      'اسم مجلد مساحة العمل الذي يجب أن يكون مفتوحًا على المُشغّل (اختياري)',
    'Prompt on a runner': 'موجّه على مُشغّل',
    'Ask me for every tool call': 'اسألني عن كل استدعاء أداة',
    'Auto-approve read-only tool calls': 'الموافقة تلقائيًا على استدعاءات الأدوات للقراءة فقط',
    'Writes and commands still wait for your approval.':
      'تظل عمليات الكتابة والأوامر بانتظار موافقتك.',
    'Runner approval policy for prompt jobs': 'سياسة موافقة المُشغّل لمهام الموجّهات',
    Allow: 'سماح',
    'A scheduled prompt job wants to use {0} ({1}). Allow it?':
      'تريد مهمة موجّه مجدولة استخدام {0} ({1}). هل تسمح بذلك؟',
  },
  de: {
    'A routine prompt must be 1 to 8000 characters.':
      'Ein Routine-Prompt muss 1 bis 8000 Zeichen lang sein.',
    'A model reference must be at most 128 characters.':
      'Eine Modellangabe darf höchstens 128 Zeichen lang sein.',
    'The repository must be a workspace folder name, not a path.':
      'Das Repository muss ein Ordnername im Arbeitsbereich sein, kein Pfad.',
    'Runner labels are up to 16 lower-case names of letters, digits, dots, dashes or underscores.':
      'Runner-Labels sind bis zu 16 kleingeschriebene Namen aus Buchstaben, Ziffern, Punkten, Bindestrichen oder Unterstrichen.',
    'Shell command on a paired device': 'Shell-Befehl auf einem gekoppelten Gerät',
    'Agent prompt on a runner': 'Agent-Prompt auf einem Runner',
    'Runs on an online runner with matching labels, even while this editor is closed.':
      'Läuft auf einem verbundenen Runner mit passenden Labels, auch wenn dieser Editor geschlossen ist.',
    'What should the routine run?': 'Was soll die Routine ausführen?',
    'Prompt the runner sends to the agent': 'Prompt, den der Runner an den Agenten sendet',
    'Model as PROVIDER/model, for example GEMINI/gemini-2.5-flash (optional)':
      'Modell als PROVIDER/model, zum Beispiel GEMINI/gemini-2.5-flash (optional)',
    'Workspace folder name the runner must have open (optional)':
      'Name des Arbeitsbereichsordners, den der Runner geöffnet haben muss (optional)',
    'Prompt on a runner': 'Prompt auf einem Runner',
    'Ask me for every tool call': 'Bei jedem Tool-Aufruf nachfragen',
    'Auto-approve read-only tool calls': 'Nur lesende Tool-Aufrufe automatisch genehmigen',
    'Writes and commands still wait for your approval.':
      'Schreibvorgänge und Befehle warten weiterhin auf Ihre Zustimmung.',
    'Runner approval policy for prompt jobs':
      'Genehmigungsrichtlinie des Runners für Prompt-Aufträge',
    Allow: 'Zulassen',
    'A scheduled prompt job wants to use {0} ({1}). Allow it?':
      'Ein geplanter Prompt-Auftrag möchte {0} ({1}) verwenden. Zulassen?',
  },
  es: {
    'A routine prompt must be 1 to 8000 characters.':
      'La instrucción de una rutina debe tener entre 1 y 8000 caracteres.',
    'A model reference must be at most 128 characters.':
      'Una referencia de modelo debe tener como máximo 128 caracteres.',
    'The repository must be a workspace folder name, not a path.':
      'El repositorio debe ser el nombre de una carpeta del espacio de trabajo, no una ruta.',
    'Runner labels are up to 16 lower-case names of letters, digits, dots, dashes or underscores.':
      'Las etiquetas del ejecutor son hasta 16 nombres en minúsculas con letras, dígitos, puntos, guiones o guiones bajos.',
    'Shell command on a paired device': 'Comando de shell en un dispositivo emparejado',
    'Agent prompt on a runner': 'Instrucción de agente en un ejecutor',
    'Runs on an online runner with matching labels, even while this editor is closed.':
      'Se ejecuta en un ejecutor conectado con etiquetas coincidentes, incluso con este editor cerrado.',
    'What should the routine run?': '¿Qué debe ejecutar la rutina?',
    'Prompt the runner sends to the agent': 'Instrucción que el ejecutor envía al agente',
    'Model as PROVIDER/model, for example GEMINI/gemini-2.5-flash (optional)':
      'Modelo como PROVIDER/model, por ejemplo GEMINI/gemini-2.5-flash (opcional)',
    'Workspace folder name the runner must have open (optional)':
      'Nombre de la carpeta del espacio de trabajo que el ejecutor debe tener abierta (opcional)',
    'Prompt on a runner': 'Instrucción en un ejecutor',
    'Ask me for every tool call': 'Preguntarme en cada llamada a herramienta',
    'Auto-approve read-only tool calls': 'Aprobar automáticamente las llamadas de solo lectura',
    'Writes and commands still wait for your approval.':
      'Las escrituras y los comandos siguen esperando tu aprobación.',
    'Runner approval policy for prompt jobs':
      'Política de aprobación del ejecutor para trabajos de instrucciones',
    Allow: 'Permitir',
    'A scheduled prompt job wants to use {0} ({1}). Allow it?':
      'Un trabajo de instrucción programado quiere usar {0} ({1}). ¿Lo permites?',
  },
  fa: {
    'A routine prompt must be 1 to 8000 characters.': 'دستور روال باید بین ۱ تا ۸۰۰۰ نویسه باشد.',
    'A model reference must be at most 128 characters.': 'مرجع مدل باید حداکثر ۱۲۸ نویسه باشد.',
    'The repository must be a workspace folder name, not a path.':
      'مخزن باید نام یک پوشه در فضای کاری باشد، نه یک مسیر.',
    'Runner labels are up to 16 lower-case names of letters, digits, dots, dashes or underscores.':
      'برچسب‌های اجراکننده حداکثر ۱۶ نام با حروف کوچک از حروف، ارقام، نقطه، خط تیره یا زیرخط هستند.',
    'Shell command on a paired device': 'فرمان پوسته روی یک دستگاه جفت‌شده',
    'Agent prompt on a runner': 'دستور عامل روی یک اجراکننده',
    'Runs on an online runner with matching labels, even while this editor is closed.':
      'روی یک اجراکننده آنلاین با برچسب‌های منطبق اجرا می‌شود، حتی وقتی این ویرایشگر بسته است.',
    'What should the routine run?': 'روال چه چیزی را اجرا کند؟',
    'Prompt the runner sends to the agent': 'دستوری که اجراکننده به عامل می‌فرستد',
    'Model as PROVIDER/model, for example GEMINI/gemini-2.5-flash (optional)':
      'مدل به شکل PROVIDER/model، برای مثال GEMINI/gemini-2.5-flash (اختیاری)',
    'Workspace folder name the runner must have open (optional)':
      'نام پوشه فضای کاری که باید روی اجراکننده باز باشد (اختیاری)',
    'Prompt on a runner': 'دستور روی یک اجراکننده',
    'Ask me for every tool call': 'برای هر فراخوانی ابزار از من بپرس',
    'Auto-approve read-only tool calls': 'تأیید خودکار فراخوانی‌های فقط‌خواندنی ابزار',
    'Writes and commands still wait for your approval.':
      'نوشتن‌ها و فرمان‌ها همچنان منتظر تأیید شما می‌مانند.',
    'Runner approval policy for prompt jobs': 'سیاست تأیید اجراکننده برای کارهای دستوری',
    Allow: 'اجازه',
    'A scheduled prompt job wants to use {0} ({1}). Allow it?':
      'یک کار دستوری زمان‌بندی‌شده می‌خواهد از {0} ({1}) استفاده کند. اجازه می‌دهید؟',
  },
  fr: {
    'A routine prompt must be 1 to 8000 characters.':
      'Le prompt d’une routine doit comporter de 1 à 8000 caractères.',
    'A model reference must be at most 128 characters.':
      'Une référence de modèle doit comporter au plus 128 caractères.',
    'The repository must be a workspace folder name, not a path.':
      'Le dépôt doit être le nom d’un dossier de l’espace de travail, pas un chemin.',
    'Runner labels are up to 16 lower-case names of letters, digits, dots, dashes or underscores.':
      'Les étiquettes d’exécuteur sont jusqu’à 16 noms en minuscules composés de lettres, chiffres, points, tirets ou traits de soulignement.',
    'Shell command on a paired device': 'Commande shell sur un appareil associé',
    'Agent prompt on a runner': 'Prompt d’agent sur un exécuteur',
    'Runs on an online runner with matching labels, even while this editor is closed.':
      'S’exécute sur un exécuteur connecté aux étiquettes correspondantes, même lorsque cet éditeur est fermé.',
    'What should the routine run?': 'Que doit exécuter la routine ?',
    'Prompt the runner sends to the agent': 'Prompt que l’exécuteur envoie à l’agent',
    'Model as PROVIDER/model, for example GEMINI/gemini-2.5-flash (optional)':
      'Modèle au format PROVIDER/model, par exemple GEMINI/gemini-2.5-flash (facultatif)',
    'Workspace folder name the runner must have open (optional)':
      'Nom du dossier de l’espace de travail que l’exécuteur doit avoir ouvert (facultatif)',
    'Prompt on a runner': 'Prompt sur un exécuteur',
    'Ask me for every tool call': 'Me demander à chaque appel d’outil',
    'Auto-approve read-only tool calls':
      'Approuver automatiquement les appels d’outils en lecture seule',
    'Writes and commands still wait for your approval.':
      'Les écritures et les commandes attendent toujours votre approbation.',
    'Runner approval policy for prompt jobs':
      'Politique d’approbation de l’exécuteur pour les tâches de prompt',
    Allow: 'Autoriser',
    'A scheduled prompt job wants to use {0} ({1}). Allow it?':
      'Une tâche de prompt planifiée veut utiliser {0} ({1}). L’autoriser ?',
  },
  hi: {
    'A routine prompt must be 1 to 8000 characters.':
      'रूटीन प्रॉम्प्ट 1 से 8000 वर्णों का होना चाहिए।',
    'A model reference must be at most 128 characters.':
      'मॉडल संदर्भ अधिकतम 128 वर्णों का होना चाहिए।',
    'The repository must be a workspace folder name, not a path.':
      'रिपॉज़िटरी वर्कस्पेस फ़ोल्डर का नाम होना चाहिए, पथ नहीं।',
    'Runner labels are up to 16 lower-case names of letters, digits, dots, dashes or underscores.':
      'रनर लेबल अधिकतम 16 छोटे अक्षरों वाले नाम होते हैं, जिनमें अक्षर, अंक, बिंदु, डैश या अंडरस्कोर हों।',
    'Shell command on a paired device': 'जोड़े गए डिवाइस पर शेल कमांड',
    'Agent prompt on a runner': 'रनर पर एजेंट प्रॉम्प्ट',
    'Runs on an online runner with matching labels, even while this editor is closed.':
      'मेल खाते लेबल वाले ऑनलाइन रनर पर चलता है, भले ही यह एडिटर बंद हो।',
    'What should the routine run?': 'रूटीन क्या चलाए?',
    'Prompt the runner sends to the agent': 'वह प्रॉम्प्ट जो रनर एजेंट को भेजता है',
    'Model as PROVIDER/model, for example GEMINI/gemini-2.5-flash (optional)':
      'मॉडल PROVIDER/model के रूप में, जैसे GEMINI/gemini-2.5-flash (वैकल्पिक)',
    'Workspace folder name the runner must have open (optional)':
      'वर्कस्पेस फ़ोल्डर का नाम जो रनर पर खुला होना चाहिए (वैकल्पिक)',
    'Prompt on a runner': 'रनर पर प्रॉम्प्ट',
    'Ask me for every tool call': 'हर टूल कॉल के लिए मुझसे पूछें',
    'Auto-approve read-only tool calls': 'केवल-पढ़ने वाले टूल कॉल स्वतः स्वीकृत करें',
    'Writes and commands still wait for your approval.':
      'लिखने और कमांड के लिए अब भी आपकी स्वीकृति की प्रतीक्षा होती है।',
    'Runner approval policy for prompt jobs': 'प्रॉम्प्ट जॉब के लिए रनर की स्वीकृति नीति',
    Allow: 'अनुमति दें',
    'A scheduled prompt job wants to use {0} ({1}). Allow it?':
      'एक निर्धारित प्रॉम्प्ट जॉब {0} ({1}) का उपयोग करना चाहता है। अनुमति दें?',
  },
  it: {
    'A routine prompt must be 1 to 8000 characters.':
      'Il prompt di una routine deve avere da 1 a 8000 caratteri.',
    'A model reference must be at most 128 characters.':
      'Un riferimento al modello deve avere al massimo 128 caratteri.',
    'The repository must be a workspace folder name, not a path.':
      'Il repository deve essere il nome di una cartella dell’area di lavoro, non un percorso.',
    'Runner labels are up to 16 lower-case names of letters, digits, dots, dashes or underscores.':
      'Le etichette del runner sono fino a 16 nomi minuscoli composti da lettere, cifre, punti, trattini o trattini bassi.',
    'Shell command on a paired device': 'Comando shell su un dispositivo associato',
    'Agent prompt on a runner': 'Prompt dell’agente su un runner',
    'Runs on an online runner with matching labels, even while this editor is closed.':
      'Viene eseguito su un runner connesso con etichette corrispondenti, anche quando questo editor è chiuso.',
    'What should the routine run?': 'Cosa deve eseguire la routine?',
    'Prompt the runner sends to the agent': 'Prompt che il runner invia all’agente',
    'Model as PROVIDER/model, for example GEMINI/gemini-2.5-flash (optional)':
      'Modello come PROVIDER/model, ad esempio GEMINI/gemini-2.5-flash (facoltativo)',
    'Workspace folder name the runner must have open (optional)':
      'Nome della cartella dell’area di lavoro che il runner deve avere aperta (facoltativo)',
    'Prompt on a runner': 'Prompt su un runner',
    'Ask me for every tool call': 'Chiedimi per ogni chiamata a uno strumento',
    'Auto-approve read-only tool calls': 'Approva automaticamente le chiamate in sola lettura',
    'Writes and commands still wait for your approval.':
      'Scritture e comandi attendono comunque la tua approvazione.',
    'Runner approval policy for prompt jobs':
      'Criterio di approvazione del runner per i lavori con prompt',
    Allow: 'Consenti',
    'A scheduled prompt job wants to use {0} ({1}). Allow it?':
      'Un lavoro con prompt pianificato vuole usare {0} ({1}). Consentirlo?',
  },
  ja: {
    'A routine prompt must be 1 to 8000 characters.':
      'ルーティンのプロンプトは 1～8000 文字にしてください。',
    'A model reference must be at most 128 characters.':
      'モデル指定は 128 文字以内にしてください。',
    'The repository must be a workspace folder name, not a path.':
      'リポジトリにはパスではなく、ワークスペースのフォルダー名を指定してください。',
    'Runner labels are up to 16 lower-case names of letters, digits, dots, dashes or underscores.':
      'ランナーのラベルは、英小文字・数字・ドット・ハイフン・アンダースコアからなる最大 16 個の名前です。',
    'Shell command on a paired device': 'ペアリング済みデバイスでのシェルコマンド',
    'Agent prompt on a runner': 'ランナーでのエージェントプロンプト',
    'Runs on an online runner with matching labels, even while this editor is closed.':
      'このエディターを閉じていても、ラベルが一致するオンラインのランナーで実行されます。',
    'What should the routine run?': 'ルーティンで何を実行しますか？',
    'Prompt the runner sends to the agent': 'ランナーがエージェントに送るプロンプト',
    'Model as PROVIDER/model, for example GEMINI/gemini-2.5-flash (optional)':
      'モデルを PROVIDER/model 形式で指定（例: GEMINI/gemini-2.5-flash、任意）',
    'Workspace folder name the runner must have open (optional)':
      'ランナーで開いている必要があるワークスペースのフォルダー名（任意）',
    'Prompt on a runner': 'ランナーでのプロンプト',
    'Ask me for every tool call': 'ツール呼び出しのたびに確認する',
    'Auto-approve read-only tool calls': '読み取り専用のツール呼び出しを自動承認する',
    'Writes and commands still wait for your approval.':
      '書き込みとコマンドは引き続き承認を待ちます。',
    'Runner approval policy for prompt jobs': 'プロンプトジョブに対するランナーの承認ポリシー',
    Allow: '許可',
    'A scheduled prompt job wants to use {0} ({1}). Allow it?':
      'スケジュールされたプロンプトジョブが {0} ({1}) を使用しようとしています。許可しますか？',
  },
  pt: {
    'A routine prompt must be 1 to 8000 characters.':
      'O prompt de uma rotina deve ter de 1 a 8000 caracteres.',
    'A model reference must be at most 128 characters.':
      'Uma referência de modelo deve ter no máximo 128 caracteres.',
    'The repository must be a workspace folder name, not a path.':
      'O repositório deve ser o nome de uma pasta do espaço de trabalho, não um caminho.',
    'Runner labels are up to 16 lower-case names of letters, digits, dots, dashes or underscores.':
      'Os rótulos do executor são até 16 nomes em minúsculas com letras, dígitos, pontos, hífenes ou sublinhados.',
    'Shell command on a paired device': 'Comando de shell em um dispositivo pareado',
    'Agent prompt on a runner': 'Prompt de agente em um executor',
    'Runs on an online runner with matching labels, even while this editor is closed.':
      'É executado em um executor conectado com rótulos correspondentes, mesmo com este editor fechado.',
    'What should the routine run?': 'O que a rotina deve executar?',
    'Prompt the runner sends to the agent': 'Prompt que o executor envia ao agente',
    'Model as PROVIDER/model, for example GEMINI/gemini-2.5-flash (optional)':
      'Modelo como PROVIDER/model, por exemplo GEMINI/gemini-2.5-flash (opcional)',
    'Workspace folder name the runner must have open (optional)':
      'Nome da pasta do espaço de trabalho que o executor deve ter aberta (opcional)',
    'Prompt on a runner': 'Prompt em um executor',
    'Ask me for every tool call': 'Perguntar a cada chamada de ferramenta',
    'Auto-approve read-only tool calls':
      'Aprovar automaticamente chamadas de ferramenta somente leitura',
    'Writes and commands still wait for your approval.':
      'Gravações e comandos continuam aguardando sua aprovação.',
    'Runner approval policy for prompt jobs':
      'Política de aprovação do executor para tarefas de prompt',
    Allow: 'Permitir',
    'A scheduled prompt job wants to use {0} ({1}). Allow it?':
      'Uma tarefa de prompt agendada quer usar {0} ({1}). Permitir?',
  },
  ru: {
    'A routine prompt must be 1 to 8000 characters.':
      'Промпт рутины должен содержать от 1 до 8000 символов.',
    'A model reference must be at most 128 characters.':
      'Ссылка на модель должна содержать не более 128 символов.',
    'The repository must be a workspace folder name, not a path.':
      'Репозиторий должен быть именем папки рабочей области, а не путём.',
    'Runner labels are up to 16 lower-case names of letters, digits, dots, dashes or underscores.':
      'Метки раннера — до 16 имён в нижнем регистре из букв, цифр, точек, дефисов или подчёркиваний.',
    'Shell command on a paired device': 'Команда оболочки на сопряжённом устройстве',
    'Agent prompt on a runner': 'Промпт агента на раннере',
    'Runs on an online runner with matching labels, even while this editor is closed.':
      'Выполняется на подключённом раннере с подходящими метками, даже когда этот редактор закрыт.',
    'What should the routine run?': 'Что должна выполнять рутина?',
    'Prompt the runner sends to the agent': 'Промпт, который раннер отправляет агенту',
    'Model as PROVIDER/model, for example GEMINI/gemini-2.5-flash (optional)':
      'Модель в виде PROVIDER/model, например GEMINI/gemini-2.5-flash (необязательно)',
    'Workspace folder name the runner must have open (optional)':
      'Имя папки рабочей области, которая должна быть открыта на раннере (необязательно)',
    'Prompt on a runner': 'Промпт на раннере',
    'Ask me for every tool call': 'Спрашивать при каждом вызове инструмента',
    'Auto-approve read-only tool calls':
      'Автоматически одобрять вызовы инструментов только для чтения',
    'Writes and commands still wait for your approval.':
      'Запись и команды по-прежнему ждут вашего одобрения.',
    'Runner approval policy for prompt jobs': 'Политика одобрения раннера для заданий с промптом',
    Allow: 'Разрешить',
    'A scheduled prompt job wants to use {0} ({1}). Allow it?':
      'Запланированное задание с промптом хочет использовать {0} ({1}). Разрешить?',
  },
  th: {
    'A routine prompt must be 1 to 8000 characters.': 'พรอมต์ของรูทีนต้องมี 1 ถึง 8000 อักขระ',
    'A model reference must be at most 128 characters.': 'การอ้างอิงโมเดลต้องมีไม่เกิน 128 อักขระ',
    'The repository must be a workspace folder name, not a path.':
      'ที่เก็บต้องเป็นชื่อโฟลเดอร์ในพื้นที่ทำงาน ไม่ใช่พาธ',
    'Runner labels are up to 16 lower-case names of letters, digits, dots, dashes or underscores.':
      'ป้ายกำกับของรันเนอร์มีได้สูงสุด 16 ชื่อ เป็นตัวพิมพ์เล็กประกอบด้วยตัวอักษร ตัวเลข จุด ขีด หรือขีดล่าง',
    'Shell command on a paired device': 'คำสั่งเชลล์บนอุปกรณ์ที่จับคู่แล้ว',
    'Agent prompt on a runner': 'พรอมต์เอเจนต์บนรันเนอร์',
    'Runs on an online runner with matching labels, even while this editor is closed.':
      'ทำงานบนรันเนอร์ที่ออนไลน์และมีป้ายกำกับตรงกัน แม้ขณะที่ปิดตัวแก้ไขนี้อยู่',
    'What should the routine run?': 'รูทีนควรรันอะไร',
    'Prompt the runner sends to the agent': 'พรอมต์ที่รันเนอร์ส่งให้เอเจนต์',
    'Model as PROVIDER/model, for example GEMINI/gemini-2.5-flash (optional)':
      'โมเดลในรูปแบบ PROVIDER/model เช่น GEMINI/gemini-2.5-flash (ไม่บังคับ)',
    'Workspace folder name the runner must have open (optional)':
      'ชื่อโฟลเดอร์พื้นที่ทำงานที่รันเนอร์ต้องเปิดไว้ (ไม่บังคับ)',
    'Prompt on a runner': 'พรอมต์บนรันเนอร์',
    'Ask me for every tool call': 'ถามฉันทุกครั้งที่เรียกใช้เครื่องมือ',
    'Auto-approve read-only tool calls':
      'อนุมัติการเรียกใช้เครื่องมือแบบอ่านอย่างเดียวโดยอัตโนมัติ',
    'Writes and commands still wait for your approval.': 'การเขียนและคำสั่งยังคงรอการอนุมัติจากคุณ',
    'Runner approval policy for prompt jobs': 'นโยบายการอนุมัติของรันเนอร์สำหรับงานพรอมต์',
    Allow: 'อนุญาต',
    'A scheduled prompt job wants to use {0} ({1}). Allow it?':
      'งานพรอมต์ที่ตั้งเวลาไว้ต้องการใช้ {0} ({1}) อนุญาตหรือไม่',
  },
  zh: {
    'A routine prompt must be 1 to 8000 characters.': '例程提示词必须为 1 到 8000 个字符。',
    'A model reference must be at most 128 characters.': '模型引用最多 128 个字符。',
    'The repository must be a workspace folder name, not a path.':
      '仓库必须是工作区文件夹名称，而不是路径。',
    'Runner labels are up to 16 lower-case names of letters, digits, dots, dashes or underscores.':
      '运行器标签最多 16 个，均为由小写字母、数字、点、连字符或下划线组成的名称。',
    'Shell command on a paired device': '在已配对设备上运行 Shell 命令',
    'Agent prompt on a runner': '在运行器上运行智能体提示词',
    'Runs on an online runner with matching labels, even while this editor is closed.':
      '在标签匹配的在线运行器上运行，即使此编辑器已关闭。',
    'What should the routine run?': '例程应运行什么？',
    'Prompt the runner sends to the agent': '运行器发送给智能体的提示词',
    'Model as PROVIDER/model, for example GEMINI/gemini-2.5-flash (optional)':
      '模型，格式为 PROVIDER/model，例如 GEMINI/gemini-2.5-flash（可选）',
    'Workspace folder name the runner must have open (optional)':
      '运行器必须打开的工作区文件夹名称（可选）',
    'Prompt on a runner': '运行器上的提示词',
    'Ask me for every tool call': '每次调用工具时询问我',
    'Auto-approve read-only tool calls': '自动批准只读工具调用',
    'Writes and commands still wait for your approval.': '写入和命令仍需等待你的批准。',
    'Runner approval policy for prompt jobs': '运行器针对提示词任务的批准策略',
    Allow: '允许',
    'A scheduled prompt job wants to use {0} ({1}). Allow it?':
      '一个定时提示词任务想要使用 {0}（{1}）。是否允许？',
  },
};
