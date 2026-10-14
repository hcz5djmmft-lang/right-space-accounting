// Arabic (improvement 3). The screens are written in English; `tr` gives the Arabic of a phrase when the person reads
// Arabic, else the English as it is. Phrases with a value in them use {name} slots. Amounts, dates and codes keep
// Western digits in both languages. Pages are translated phone first: sign-in, the menu, Clock in, Tasks, Approvals
// and Site execution; a phrase with no Arabic yet simply stays in English.

export type Lang = 'en' | 'ar';
export const LANG_COOKIE = 'rs_lang';
export const isLang = (v: unknown): v is Lang => v === 'en' || v === 'ar';

const AR: Record<string, string> = {
  // sign-in and the switch
  'Email': 'البريد الإلكتروني', 'Password': 'كلمة المرور', 'Sign in': 'تسجيل الدخول', 'Sign out': 'تسجيل الخروج',
  'Wrong email or password.': 'البريد الإلكتروني أو كلمة المرور غير صحيحة.', 'Too many wrong attempts. Try again in 15 minutes.': 'محاولات خاطئة كثيرة. حاول مرة أخرى بعد 15 دقيقة.',
  'Language': 'اللغة', 'English': 'English', 'العربية': 'العربية', 'Save language': 'حفظ اللغة',
  'The menus and the phone pages (Clock in, Tasks, Approvals, Site execution) show in the language you pick. Amounts and dates keep Western digits.': 'تظهر القوائم وصفحات الموبايل (الحضور، المهام، الموافقات، التنفيذ بالموقع) باللغة التي تختارها. تبقى المبالغ والتواريخ بالأرقام الإنجليزية.',

  // menu groups and items
  'Overview': 'الرئيسية', 'Clock in': 'الحضور', 'Leave': 'الإجازات', 'Approvals': 'الموافقات', 'Tasks': 'المهام', 'Expenses': 'المصروفات', 'Site': 'الموقع',
  'Finance': 'المالية', "Partners' dashboard": 'لوحة الشركاء', 'Entries': 'القيود', 'Chart of accounts': 'دليل الحسابات', 'Opening balances': 'الأرصدة الافتتاحية',
  'Month-end close': 'إقفال الشهر', 'Budgets': 'الموازنات', 'Fixed assets': 'الأصول الثابتة', 'Banks & cash': 'البنوك والنقدية', 'Petty cash': 'العهدة النقدية',
  'Partners': 'الشركاء', 'Payment requests': 'طلبات الصرف', 'Payables': 'المستحقات للموردين', 'Collections': 'التحصيلات', 'Collections follow-up': 'متابعة التحصيل',
  'Sales invoices': 'فواتير المبيعات', 'Customers & vendors': 'العملاء والموردون', 'Payroll': 'المرتبات', 'Requests': 'الطلبات',
  'Purchasing': 'المشتريات', 'Purchase requests': 'طلبات الشراء', 'Material plan': 'خطة الخامات', 'Vendors': 'الموردون', 'Work orders': 'أوامر الشغل',
  'Site stock': 'مخزون الموقع', 'Progress claims': 'المستخلصات', 'Procurement reports': 'تقارير المشتريات', 'Materials': 'الخامات',
  'HR': 'الموارد البشرية', 'Employees': 'الموظفون', 'Attendance': 'الحضور والانصراف', 'Pay items': 'بنود المرتب', 'HR reports': 'تقارير الموارد البشرية',
  'Projects': 'المشروعات', 'Cost centers': 'مراكز التكلفة', 'Design': 'التصميم', 'QS and pricing': 'الحصر والتسعير', 'Planning': 'التخطيط',
  'Variation orders': 'أوامر التغيير', 'Samples': 'العينات', 'Cost control': 'مراقبة التكلفة', 'Site execution': 'التنفيذ بالموقع', 'Tenders': 'المناقصات',
  'Insight': 'التقارير', 'Reports': 'التقارير', 'Admin': 'الإدارة', 'Settings': 'الإعدادات', 'Audit log': 'سجل التغييرات', 'My account': 'حسابي',

  // clock in
  'Your login is not linked to an employee file yet, so there is nothing to clock.': 'حسابك غير مربوط بملف موظف بعد، لذلك لا يوجد حضور لتسجيله.',
  'Ask HR to link it from your employee file.': 'اطلب من الموارد البشرية ربطه من ملف الموظف.',
  'Site staff': 'موظف موقع', 'Office staff': 'موظف مكتب',
  'Say what the day is for when you clock in; Switch when it changes.': 'اختر نوع العمل عند تسجيل الحضور، واضغط تبديل عندما يتغير.',
  'Switch during the day': 'التبديل خلال اليوم', 'Now:': 'الآن:', 'since': 'منذ',
  'Moving to something else? Pick it here: each stretch keeps its hours, and design hours go to the project with their cost.': 'هتنتقل لشغل تاني؟ اختاره هنا: كل فترة تحتفظ بساعاتها، وساعات التصميم تُحمّل على المشروع بتكلفتها.',
  'Switch to': 'التبديل إلى', 'What (optional): Concept 3D, shop drawings…': 'ماذا (اختياري): تصميم ثلاثي الأبعاد، رسومات تنفيذية…', 'Switch': 'تبديل',
  'This month': 'هذا الشهر', 'Days': 'الأيام', 'Worked': 'ساعات العمل', 'Late': 'التأخير', 'Overtime': 'الإضافي', 'Day': 'اليوم', 'In': 'حضور', 'Out': 'انصراف',
  'What': 'العمل', 'From': 'من', 'To': 'إلى', 'Hours': 'الساعات',
  'Clocked in at': 'سجلت الحضور الساعة', 'Not clocked in': 'لم تسجل الحضور', 'Clock in for': 'تسجيل الحضور لـ', 'Working…': 'جارٍ التنفيذ…',
  '📷 Clock in': '📷 تسجيل الحضور', '📷 Clock out': '📷 تسجيل الانصراف', 'Choose the project.': 'اختر المشروع.', 'Finding your location…': 'جارٍ تحديد موقعك…', 'Sending…': 'جارٍ الإرسال…', 'Done.': 'تم.',
  'The photo could not be sent. Check the connection and try again.': 'تعذر إرسال الصورة. تأكد من الاتصال وحاول مرة أخرى.',
  'The camera opens for a selfie; your location is sent with it and the system tells you where it saw you.': 'تفتح الكاميرا لصورة سيلفي؛ يُرسل موقعك معها ويخبرك النظام أين رآك.',
  'Project': 'المشروع', 'Choose…': 'اختر…',
  'No active project yet: ask Engineering or Finance to add it, or clock in for Office.': 'لا يوجد مشروع نشط بعد: اطلب من الهندسة أو المالية إضافته، أو سجّل الحضور للمكتب.',
  'No selfie or position for a switch: the stretch so far is closed and the new one starts now.': 'لا سيلفي ولا موقع عند التبديل: تُغلق الفترة الحالية وتبدأ الجديدة الآن.',
  'Clock in within {m} m of the {code} location pin.': 'سجّل الحضور في حدود {m} متر من موقع {code}.',
  '{code} has no location pin yet: your position is recorded only.': '{code} ليس له موقع محدد بعد: يُسجل موقعك فقط.',
  'Clock in within {m} m of the office.': 'سجّل الحضور في حدود {m} متر من المكتب.',
  'The office location is not set yet: your position is recorded only.': 'موقع المكتب غير محدد بعد: يُسجل موقعك فقط.',
  'at the office': 'في المكتب', 'on site': 'في الموقع', 'away': 'خارج النطاق', 'position recorded': 'تم تسجيل الموقع', 'no location': 'بدون موقع',
  // clock-in categories
  'Office': 'المكتب', 'Site on a project': 'موقع مشروع', 'Design on a project': 'تصميم مشروع', 'Payments': 'المدفوعات', 'Bank and petty cash': 'البنك والعهدة',
  'Reports, tax and closing': 'التقارير والضرائب والإقفال', 'Bank & cash': 'البنك والنقدية', 'Reports & tax': 'التقارير والضرائب', 'on': 'على',

  // tasks
  'Follow-ups, month-end steps and anything the team needs to get done.': 'المتابعات وخطوات نهاية الشهر وكل ما يحتاج الفريق إنجازه.',
  'New task': 'مهمة جديدة', 'Pending steps for you': 'خطوات بانتظارك',
  "Every step in the system that waits for your input: approvals, forms, drawings, estimates, schedules and the week's progress. Each clears by itself once it is done.": 'كل خطوة في النظام تنتظر منك إجراءً: موافقات ونماذج ورسومات وتسعيرات وجداول وتقدم الأسبوع. تختفي كل خطوة تلقائياً عند إنجازها.',
  'All tasks': 'كل المهام', 'Assigned to me': 'المسندة إليّ', 'No tasks': 'لا توجد مهام', 'Unassigned': 'غير مسندة', 'high': 'عاجلة',
  'To do': 'للتنفيذ', 'In progress': 'قيد التنفيذ', 'Review': 'مراجعة', 'Done': 'تم',

  // approvals
  'Everything waiting for your signature.': 'كل ما ينتظر توقيعك.', 'Nothing is waiting for you.': 'لا يوجد شيء بانتظارك.',
  'No.': 'رقم', 'Type': 'النوع', 'Date': 'التاريخ', 'Vendor / description': 'المورد / البيان', 'Raised by': 'مقدم الطلب', 'Amount': 'المبلغ',
  'Payment request': 'طلب صرف', 'Purchase request': 'طلب شراء', 'Entry': 'قيد', 'Expense': 'مصروف', 'Drawing set': 'مجموعة رسومات', 'Progress claim': 'مستخلص',
  'Petty cash top-up': 'تعزيز العهدة', 'Management': 'الإدارة', 'Department head': 'رئيس القسم', 'Procurement pricing': 'تسعير المشتريات',
  'Finance payment request': 'طلب صرف المالية', 'Engineering head': 'رئيس الهندسة', 'Finance head': 'رئيس المالية',

  // site execution
  'My sites': 'مواقعي', 'Daily reports': 'التقارير اليومية', 'Inspections': 'الاستلامات', 'Snag list': 'قائمة الملاحظات', 'Summary': 'الملخص',
  'Every day the site engineer sends the site report from the phone (work done, manpower, photos), asks for an inspection before covering a work, and keeps the snag list; the handover certificate closes the site.': 'يرسل مهندس الموقع تقرير الموقع يومياً من الموبايل (الأعمال المنفذة والعمالة والصور)، ويطلب الاستلام قبل تغطية أي عمل، ويتابع قائمة الملاحظات؛ وشهادة التسليم تغلق الموقع.',
  'Schedules': 'الجداول الزمنية', 'All sites': 'كل المواقع', 'Show': 'عرض', 'Month': 'الشهر',
  'You are not set as the site engineer or manager of any running project, so there is no site to report on. Finance sets the site engineer on the project page.': 'لست مهندس موقع أو مدير أي مشروع جارٍ، لذلك لا يوجد موقع لتقريره. تحدد المالية مهندس الموقع من صفحة المشروع.',
  'No project is in Execution or Handover yet. A project gets there when its schedule baseline is set (Planning), or by hand from the project page.': 'لا يوجد مشروع في التنفيذ أو التسليم بعد. يصل المشروع لها عند اعتماد الجدول الزمني (التخطيط) أو يدوياً من صفحة المشروع.',
  'Site engineer': 'مهندس الموقع', 'manager': 'المدير', 'last report': 'آخر تقرير', 'none yet': 'لا يوجد بعد', 'yours': 'مشروعك',
  "Finish today's report": 'استكمل تقرير اليوم', "Today's report": 'تقرير اليوم', 'Ask for inspection': 'طلب استلام', 'Handover': 'التسليم',
  'Handover certificate ✓': 'شهادة التسليم ✓', 'Handover certificate (draft)': 'شهادة التسليم (مسودة)',
  'reports': 'تقارير', 'inspections waiting': 'استلامات منتظرة', 'open snags': 'ملاحظات مفتوحة', 'fixed to verify': 'تم إصلاحها للتحقق',
  "No site report yet. Open My sites and tap Today's report.": 'لا يوجد تقرير موقع بعد. افتح مواقعي واضغط تقرير اليوم.',
  'Report': 'التقرير', 'Manpower': 'العمالة', 'Work done': 'الأعمال المنفذة', 'Photos': 'الصور', 'Status': 'الحالة',
  'No inspection requested yet.': 'لم يُطلب أي استلام بعد.', 'Request': 'الطلب', 'Where': 'المكان', 'For': 'موعد', 'Inspector': 'المستلم', 'Result': 'النتيجة',
  'No open snag.': 'لا توجد ملاحظات مفتوحة.', 'Snag': 'الملاحظة', 'Trade': 'البند', 'Assigned to': 'مسندة إلى', 'Due': 'الموعد', 'Open the snag list of {code}': 'افتح قائمة ملاحظات {code}',
  'Nothing on site yet.': 'لا يوجد شيء في الموقع بعد.', 'Man-days': 'يوم عمل', 'Snags open': 'ملاحظات مفتوحة', 'Passed · failed': 'مقبول · مرفوض', 'Verified': 'تم التحقق',
  "Reports, man-days and hours are the month's sent reports; inspections and snags are the totals to date.": 'التقارير وأيام العمل والساعات من تقارير الشهر المرسلة؛ الاستلامات والملاحظات إجمالي حتى اليوم.',
  'Draft': 'مسودة', 'Sent': 'مرسل', 'Reviewed': 'تمت المراجعة', 'Waiting for inspection': 'بانتظار الاستلام', 'Passed': 'مقبول', 'Failed': 'مرفوض', 'Cancelled': 'ملغى',
  'Open': 'مفتوحة', 'Fixed': 'تم الإصلاح', 'signed': 'موقعة', 'draft': 'مسودة',
  'Project form': 'نموذج المشروع', 'Execution': 'التنفيذ', 'Closed': 'مغلق',
};

/** The phrase in the person's language; {slots} filled from `v`. */
export function tr(lang: Lang, s: string, v: Record<string, string | number> = {}) {
  const t = lang === 'ar' ? AR[s] ?? s : s;
  return t.replace(/\{(\w+)\}/g, (m, k: string) => (k in v ? String(v[k]) : m));
}
/** "Payment request · Management": each part translated. */
export const trParts = (lang: Lang, s: string) => s.split(' · ').map(p => tr(lang, p)).join(' · ');
export const hasArabic = (s: string) => s in AR;

/** The sentence after a clock-in or clock-out (whereText) in Arabic. */
export function trClockMessage(lang: Lang, s: string) {
  if (lang !== 'ar') return s;
  const m = /^(Clocked in|Clocked out)(.*?)( without a location| about \d+ m from| at the office|, \d+ m from|\. Your position was recorded)(.*)$/.exec(s);
  if (!m) return s;
  const head = m[1] === 'Clocked in' ? 'تم تسجيل الحضور' : 'تم تسجيل الانصراف';
  const num = (re: RegExp) => re.exec(s)?.[1];
  const acc = num(/accurate to about (\d+) m/) ? ` (بدقة حوالي ${num(/accurate to about (\d+) m/)} متر)` : '';
  if (m[3] === ' without a location') return `${head} بدون موقع: لم يرسل الموبايل موقعه. اسمح بالموقع لهذا الموقع: في Safari اضغط aA بجوار العنوان، ثم إعدادات الموقع، الموقع، سماح.`;
  if (m[3] === '. Your position was recorded') return `${head}. تم تسجيل موقعك${acc}؛ ${/project has no location pin/.test(s) ? 'هذا المشروع ليس له موقع محدد بعد' : 'موقع المكتب غير محدد بعد'}، لذلك لم تتم المقارنة.`;
  if (m[3].startsWith(' about')) return `${head} على بعد حوالي ${num(/about (\d+) m/)} متر من ${/project pin/.test(s) ? 'موقع المشروع' : 'المكتب'}، خارج المسافة المسموحة؛ ستراه الموارد البشرية.`;
  if (m[3] === ' at the office') return `${head} في المكتب، على بعد ${num(/, (\d+) m from its pin/)} متر من موقعه${acc}.`;
  return `${head}، على بعد ${num(/, (\d+) m from/)} متر من موقع المشروع${acc}.`;
}
