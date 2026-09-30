// Secure-by-default plugins: workspace plugins wait for approval, and a hook
// approval is bound to the exact commands.
const keys = [
  'Needs your approval',
  'Hooks need re-approval',
  'Approve again',
  'Workspace plugin: it came with this repository and does nothing until you enable it.',
  'The hooks of {0} changed since you approved them. Approve again? These commands are new or changed: {1}',
  'Your earlier approval of the hooks of {0} no longer applies, because approvals now cover the exact commands. Approve again? They run: {1}',
];

const values = {
  ar: [
    'بحاجة إلى موافقتك',
    'الخطافات بحاجة إلى موافقة جديدة',
    'الموافقة مرة أخرى',
    'إضافة مساحة العمل: جاءت مع هذا المستودع ولا تفعل شيئًا حتى تفعّلها.',
    'تغيّرت خطافات {0} منذ موافقتك عليها. هل توافق مرة أخرى؟ هذه الأوامر جديدة أو متغيرة: {1}',
    'لم تعد موافقتك السابقة على خطافات {0} سارية، لأن الموافقات أصبحت تشمل الأوامر بالتحديد. هل توافق مرة أخرى؟ تشغّل: {1}',
  ],
  de: [
    'Benötigt Ihre Zustimmung',
    'Hooks müssen erneut genehmigt werden',
    'Erneut genehmigen',
    'Arbeitsbereich-Plugin: Es kam mit diesem Repository und tut nichts, bis Sie es aktivieren.',
    'Die Hooks von {0} haben sich seit Ihrer Genehmigung geändert. Erneut genehmigen? Diese Befehle sind neu oder geändert: {1}',
    'Ihre frühere Genehmigung der Hooks von {0} gilt nicht mehr, weil Genehmigungen jetzt die genauen Befehle umfassen. Erneut genehmigen? Sie führen aus: {1}',
  ],
  es: [
    'Necesita tu aprobación',
    'Los hooks necesitan aprobarse de nuevo',
    'Aprobar de nuevo',
    'Complemento del espacio de trabajo: llegó con este repositorio y no hace nada hasta que lo actives.',
    'Los hooks de {0} cambiaron desde que los aprobaste. ¿Aprobar de nuevo? Estos comandos son nuevos o han cambiado: {1}',
    'Tu aprobación anterior de los hooks de {0} ya no es válida, porque las aprobaciones ahora cubren los comandos exactos. ¿Aprobar de nuevo? Ejecutan: {1}',
  ],
  fa: [
    'به تأیید شما نیاز دارد',
    'هوک‌ها باید دوباره تأیید شوند',
    'تأیید دوباره',
    'افزونه فضای کاری: همراه با این مخزن آمده و تا زمانی که آن را فعال نکنید کاری انجام نمی‌دهد.',
    'هوک‌های {0} از زمان تأیید شما تغییر کرده‌اند. دوباره تأیید می‌کنید؟ این دستورها جدید یا تغییریافته‌اند: {1}',
    'تأیید قبلی شما برای هوک‌های {0} دیگر معتبر نیست، چون تأییدها اکنون دستورهای دقیق را در بر می‌گیرند. دوباره تأیید می‌کنید؟ این‌ها اجرا می‌کنند: {1}',
  ],
  fr: [
    'Nécessite votre approbation',
    'Les hooks doivent être approuvés à nouveau',
    'Approuver à nouveau',
    'Plugin d’espace de travail : il est arrivé avec ce dépôt et ne fait rien tant que vous ne l’activez pas.',
    'Les hooks de {0} ont changé depuis votre approbation. Approuver à nouveau ? Ces commandes sont nouvelles ou modifiées : {1}',
    'Votre approbation précédente des hooks de {0} n’est plus valide, car les approbations couvrent désormais les commandes exactes. Approuver à nouveau ? Ils exécutent : {1}',
  ],
  hi: [
    'आपकी स्वीकृति चाहिए',
    'हुक को दोबारा स्वीकृति चाहिए',
    'फिर से स्वीकृत करें',
    'वर्कस्पेस प्लगइन: यह इस रिपॉज़िटरी के साथ आया है और आपके सक्षम करने तक कुछ नहीं करता।',
    'आपकी स्वीकृति के बाद {0} के हुक बदल गए हैं। फिर से स्वीकृत करें? ये कमांड नई या बदली हुई हैं: {1}',
    '{0} के हुक की आपकी पिछली स्वीकृति अब लागू नहीं है, क्योंकि स्वीकृतियाँ अब सटीक कमांड पर लागू होती हैं। फिर से स्वीकृत करें? ये चलाते हैं: {1}',
  ],
  it: [
    'Richiede la tua approvazione',
    'Gli hook richiedono una nuova approvazione',
    'Approva di nuovo',
    'Plugin dell’area di lavoro: è arrivato con questo repository e non fa nulla finché non lo abiliti.',
    'Gli hook di {0} sono cambiati da quando li hai approvati. Approvare di nuovo? Questi comandi sono nuovi o modificati: {1}',
    'La tua precedente approvazione degli hook di {0} non è più valida, perché le approvazioni ora coprono i comandi esatti. Approvare di nuovo? Eseguono: {1}',
  ],
  ja: [
    '承認が必要です',
    'フックの再承認が必要です',
    '再度承認',
    'ワークスペースのプラグイン: このリポジトリに含まれており、有効にするまで何も実行しません。',
    '{0} のフックは承認後に変更されました。再度承認しますか？ 新規または変更されたコマンド: {1}',
    '{0} のフックに対する以前の承認は、承認が正確なコマンドを対象とするようになったため、無効になりました。再度承認しますか？ 実行するコマンド: {1}',
  ],
  pt: [
    'Precisa da sua aprovação',
    'Os hooks precisam de nova aprovação',
    'Aprovar novamente',
    'Plugin do espaço de trabalho: veio com este repositório e não faz nada até você ativá-lo.',
    'Os hooks de {0} mudaram desde que você os aprovou. Aprovar novamente? Estes comandos são novos ou foram alterados: {1}',
    'Sua aprovação anterior dos hooks de {0} não vale mais, porque as aprovações agora cobrem os comandos exatos. Aprovar novamente? Eles executam: {1}',
  ],
  ru: [
    'Требуется ваше одобрение',
    'Хуки нужно одобрить заново',
    'Одобрить снова',
    'Плагин рабочей области: он пришёл вместе с этим репозиторием и ничего не делает, пока вы его не включите.',
    'Хуки {0} изменились после того, как вы их одобрили. Одобрить снова? Эти команды новые или изменённые: {1}',
    'Ваше прежнее одобрение хуков {0} больше не действует, потому что теперь одобрение относится к точным командам. Одобрить снова? Они запускают: {1}',
  ],
  th: [
    'ต้องได้รับการอนุมัติจากคุณ',
    'ฮุกต้องได้รับการอนุมัติอีกครั้ง',
    'อนุมัติอีกครั้ง',
    'ปลั๊กอินของเวิร์กสเปซ: มาพร้อมกับที่เก็บนี้ และจะไม่ทำอะไรจนกว่าคุณจะเปิดใช้งาน',
    'ฮุกของ {0} เปลี่ยนไปตั้งแต่ที่คุณอนุมัติ อนุมัติอีกครั้งหรือไม่ คำสั่งเหล่านี้เป็นคำสั่งใหม่หรือมีการเปลี่ยนแปลง: {1}',
    'การอนุมัติฮุกของ {0} ก่อนหน้านี้ใช้ไม่ได้อีกต่อไป เนื่องจากการอนุมัติครอบคลุมคำสั่งที่ตรงกันทุกตัว อนุมัติอีกครั้งหรือไม่ ฮุกเหล่านี้รัน: {1}',
  ],
  zh: [
    '需要你的批准',
    '钩子需要重新批准',
    '再次批准',
    '工作区插件：它随此仓库而来，在你启用之前不会执行任何操作。',
    '自你批准后，{0} 的钩子已更改。要重新批准吗？以下命令是新增或已更改的：{1}',
    '你之前对 {0} 钩子的批准已失效，因为批准现在针对确切的命令。要重新批准吗？它们运行：{1}',
  ],
};

export const pluginApprovalTranslations = Object.fromEntries(
  Object.entries(values).map(([locale, list]) => [
    locale,
    Object.fromEntries(keys.map((key, index) => [key, list[index]])),
  ]),
);
