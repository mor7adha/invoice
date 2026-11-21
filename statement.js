(() => {
  'use strict';

  const byId = id => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const ROWS_PER_PAGE = 12;
  const PAGE_WIDTH = 595.28;
  const PAGE_HEIGHT = 841.89;
  const DPI_SCALE = 300 / 72;
  const DEFAULT_LOGOS = {
    header: { href: 'assets/فوق.jpeg', width: 1280, height: 666, viewBox: '149 63 990 515' },
    footer: { href: 'assets/تحت.jpeg', width: 1168, height: 896, viewBox: '70 307 1047 281' }
  };
  let rows = [];
  let customLogo = '';
  let logoReadVersion = 0;
  let outputTime = new Date();
  let busy = false;
  const embeddedAssets = new Map();

  function element(tag, attributes = {}, text = '') {
    const node = document.createElementNS(NS, tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    if (text !== '') node.textContent = text;
    return node;
  }

  function text(svg, value, x, y, options = {}) {
    const node = element('text', {
      x, y, fill: '#000', 'font-size': 11, 'font-family': 'Statement Arial, Arial, sans-serif',
      'text-anchor': 'middle', ...options
    }, value);
    svg.append(node);
    return node;
  }

  function arabic(svg, value, x, y, options = {}) {
    return text(svg, value, x, y, {
      'font-family': 'Statement Arabic, Arabic Full, Arial, sans-serif',
      direction: 'rtl', 'unicode-bidi': 'plaintext', ...options
    });
  }

  function line(svg, x1, y1, x2, y2) {
    svg.append(element('line', { x1, y1, x2, y2, stroke: '#111', 'stroke-width': 1 }));
  }

  function box(svg, x, y, width, height, fill = '#fff') {
    svg.append(element('rect', { x, y, width, height, fill, stroke: '#111', 'stroke-width': 1 }));
  }

  function multiline(svg, value, x, centerY, maxWidth, options = {}) {
    const lines = String(value || '').split('\n');
    const size = options['font-size'] || 10.5;
    const step = Math.min(size + 1, 38 / Math.max(1, lines.length));
    lines.forEach((part, index) => {
      const isArabic = /[\u0600-\u06ff]/.test(part);
      const draw = isArabic ? arabic : text;
      const node = draw(svg, part, x, centerY + (index - (lines.length - 1) / 2) * step + size * 0.32, options);
      node.dataset.fitWidth = maxWidth;
    });
  }

  function fitText() {
    byId('sPreview').querySelectorAll('[data-fit-width]').forEach(node => {
      node.removeAttribute('textLength');
      node.removeAttribute('lengthAdjust');
      if (node.getComputedTextLength() > Number(node.dataset.fitWidth)) {
        node.setAttribute('textLength', node.dataset.fitWidth);
        node.setAttribute('lengthAdjust', 'spacingAndGlyphs');
      }
    });
  }

  function cents(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.round((parsed + Math.sign(parsed) * Number.EPSILON) * 100) : 0;
  }

  function money(value) {
    return (value / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function isoToday() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  function longDate(value) {
    if (!value) return '';
    const date = new Date(`${value}T12:00:00`);
    if (!Number.isFinite(date.getTime())) return '';
    return `${date.getDate()} ${date.toLocaleString('en-GB', { month: 'long' })}, ${date.getFullYear()}`;
  }

  function footerDate(date) {
    const pad = n => String(n).padStart(2, '0');
    const hour = date.getHours();
    return `${date.toLocaleString('en-GB', { weekday: 'long' })}, ${date.getDate()} ${date.toLocaleString('en-GB', { month: 'long' })}, ${date.getFullYear()} ${pad(hour % 12 || 12)}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ${hour >= 12 ? 'PM' : 'AM'}`;
  }

  function calculate() {
    let balance = cents(byId('sOpening').value);
    let debit = 0;
    let credit = 0;
    let debitCount = 0;
    let creditCount = 0;
    const movements = rows.map(row => {
      const debitValue = cents(row.debit);
      const creditValue = cents(row.credit);
      debit += debitValue;
      credit += creditValue;
      if (debitValue > 0) debitCount++;
      if (creditValue > 0) creditCount++;
      balance += creditValue - debitValue;
      return { ...row, debitValue, creditValue, balance };
    });
    return { movements, debit, credit, debitCount, creditCount, balance };
  }

  function aging(data) {
    const buckets = Array.from({ length: 5 }, () => ({ count: 0, amount: 0 }));
    const asOf = Date.parse(`${byId('sTo').value}T00:00:00Z`);
    const liabilities = data.movements.filter(row => row.creditValue > 0).map(row => ({
      amount: row.creditValue, due: row.due || row.date || byId('sTo').value, counted: true
    }));
    const opening = cents(byId('sOpening').value);
    if (opening > 0) liabilities.push({ amount: opening, due: byId('sFrom').value, counted: false });
    liabilities.sort((a, b) => a.due.localeCompare(b.due));
    let payments = data.debit + Math.max(0, -opening);
    liabilities.forEach(item => {
      const settled = Math.min(payments, item.amount);
      payments -= settled;
      const days = Math.max(0, Math.floor((asOf - Date.parse(`${item.due}T00:00:00Z`)) / 86400000)) || 0;
      const index = days <= 30 ? 0 : days <= 60 ? 1 : days <= 90 ? 2 : days <= 120 ? 3 : 4;
      buckets[index].amount += item.amount - settled;
      if (item.counted) buckets[index].count++;
    });
    // Keep the aging total equal to the closing balance, including supplier advances.
    if (payments > 0) buckets[0].amount -= payments;
    return buckets;
  }

  const enOnes = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const enTens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  function englishNumber(value) {
    if (value < 20) return enOnes[value];
    if (value < 100) return enTens[Math.floor(value / 10)] + (value % 10 ? ` ${enOnes[value % 10]}` : '');
    if (value < 1000) return `${enOnes[Math.floor(value / 100)]} Hundred` + (value % 100 ? ` ${englishNumber(value % 100)}` : '');
    for (const [scale, label] of [[1e12, 'Trillion'], [1e9, 'Billion'], [1e6, 'Million'], [1000, 'Thousand']]) {
      if (value >= scale) return `${englishNumber(Math.floor(value / scale))} ${label}` + (value % scale ? ` ${englishNumber(value % scale)}` : '');
    }
    return String(value);
  }

  const arOnes = ['صفر', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
  const arTens = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
  const arHundreds = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];
  function arabicNumber(value) {
    if (value < 20) return arOnes[value];
    if (value < 100) return (value % 10 ? `${arOnes[value % 10]} و` : '') + arTens[Math.floor(value / 10)];
    if (value < 1000) return arHundreds[Math.floor(value / 100)] + (value % 100 ? ` و${arabicNumber(value % 100)}` : '');
    for (const [scale, singular, dual, plural] of [[1e12, 'تريليون', 'تريليونان', 'تريليونات'], [1e9, 'مليار', 'ملياران', 'مليارات'], [1e6, 'مليون', 'مليونان', 'ملايين'], [1000, 'ألف', 'ألفان', 'آلاف']]) {
      if (value >= scale) {
        const count = Math.floor(value / scale);
        const group = count === 1 ? singular : count === 2 ? dual : `${arabicNumber(count)} ${count <= 10 ? plural : singular}`;
        return group + (value % scale ? ` و${arabicNumber(value % scale)}` : '');
      }
    }
    return String(value);
  }

  function amountWords(value) {
    const absolute = Math.abs(value);
    const units = Math.floor(absolute / 100);
    const fraction = absolute % 100;
    const currency = byId('sCurrency').value.trim();
    const saudi = currency === 'ريال سعودي';
    return {
      ar: byId('sWordsAr').value || `فقط ${value < 0 ? 'سالب ' : ''}${arabicNumber(units)} ${currency}${fraction ? ` و${arabicNumber(fraction)} ${saudi ? 'هللة' : 'جزء من مائة'}` : ''} لا غير.`,
      en: byId('sWordsEn').value || `${value < 0 ? 'Minus ' : ''}${englishNumber(units)} ${saudi ? 'Saudi Riyals' : currency}${fraction ? ` and ${englishNumber(fraction)} ${saudi ? 'Halalas' : 'Hundredths'}` : ''} only.`
    };
  }

  function drawLogo(svg, logo, x, y, width, height) {
    const crop = element('svg', { x, y, width, height, viewBox: logo.viewBox, preserveAspectRatio: 'xMidYMid meet', overflow: 'hidden' });
    crop.append(element('image', { href: logo.href, width: logo.width, height: logo.height }));
    svg.append(crop);
  }

  function drawHeader(svg) {
    multiline(svg, byId('sCompanyEn').value, 28, 35, 250, { 'text-anchor': 'start', 'font-size': 13, 'font-weight': 700 });
    text(svg, `C.R : ${byId('sRegistration').value}`, 28, 70, { 'text-anchor': 'start', 'font-size': 13, 'font-weight': 700 });
    text(svg, `Tel : ${byId('sPhone').value}`, 28, 91, { 'text-anchor': 'start', 'font-size': 13, 'font-weight': 700 });
    multiline(svg, byId('sCompanyAr').value, 703, 33, 250, { 'text-anchor': 'start', 'font-size': 13, 'font-weight': 700 });
    arabic(svg, `س.ت : ${byId('sRegistration').value}`, 703, 58, { 'text-anchor': 'start', 'font-size': 12, 'font-weight': 700 });
    arabic(svg, `ت : ${byId('sPhone').value}`, 703, 79, { 'text-anchor': 'start', 'font-size': 12, 'font-weight': 700 });
    if (customLogo) svg.append(element('image', { href: customLogo, x: 305, y: 18, width: 120, height: 67, preserveAspectRatio: 'xMidYMid meet' }));
    else drawLogo(svg, DEFAULT_LOGOS.header, 305, 18, 120, 67);
    const title = arabic(svg, byId('sTitle').value, 364, 117, { 'font-size': 17, 'font-weight': 700 });
    title.dataset.fitWidth = 550;
    const supplier = arabic(svg, `المورد : ${byId('sSupplier').value}`, 683, 141, { 'text-anchor': 'start', 'font-size': 12, 'font-weight': 700 });
    supplier.dataset.fitWidth = 600;
    arabic(svg, `رقم المورد : ${byId('sSupplierNo').value}`, 683, 164, { 'text-anchor': 'start', 'font-size': 12, 'font-weight': 700 });
    arabic(svg, `العملة : ${byId('sCurrency').value}`, 410, 166, { 'text-anchor': 'start', 'font-size': 12, 'font-weight': 700 });
    arabic(svg, 'من تاريخ :', 683, 189, { 'text-anchor': 'start', 'font-size': 12, 'font-weight': 700 });
    text(svg, longDate(byId('sFrom').value), 618, 189, { 'text-anchor': 'end', 'font-size': 12, 'font-weight': 700 });
    arabic(svg, 'إلى تاريخ :', 345, 189, { 'text-anchor': 'start', 'font-size': 12, 'font-weight': 700 });
    text(svg, longDate(byId('sTo').value), 284, 189, { 'text-anchor': 'end', 'font-size': 12, 'font-weight': 700 });
  }

  function drawAging(svg, data, y) {
    const edges = [32, 139, 245, 337, 429, 521, 609, 695];
    box(svg, 32, y, 663, 54);
    const labels = ['إجمالي المدين', 'إجمالي الدائن', '> 120', '91 - 120', '61 - 90', '31 - 60', '0 - 30'];
    labels.forEach((label, i) => {
      const x = (edges[i] + edges[i + 1]) / 2;
      (i < 2 ? arabic : text)(svg, label, x, y + 17, { 'font-size': 12, 'font-weight': 700 });
    });
    text(svg, money(data.debit), 85.5, y + 43, { 'font-size': 12, 'font-weight': 700, 'data-summary': 'debit' });
    text(svg, money(data.credit), 192, y + 43, { 'font-size': 12, 'font-weight': 700, 'data-summary': 'credit' });
    aging(data).reverse().forEach((bucket, i) => {
      const x = (edges[i + 2] + edges[i + 3]) / 2;
      text(svg, bucket.count, x, y + 34, { 'font-size': 12, 'font-weight': 700, 'data-aging-count': 4 - i });
      text(svg, money(bucket.amount), x, y + 49, { 'font-size': 12, 'font-weight': 700, 'data-aging-amount': 4 - i });
    });
  }

  function renderPage(data, pageIndex, pageCount) {
    const svg = element('svg', { xmlns: NS, viewBox: '0 0 725 1080', preserveAspectRatio: 'none', role: 'img', 'aria-label': `كشف حساب، صفحة ${pageIndex + 1} من ${pageCount}` });
    svg.append(element('rect', { width: 725, height: 1080, fill: '#fff' }));
    drawHeader(svg);
    const start = pageIndex * ROWS_PER_PAGE;
    const pageRows = data.movements.slice(start, start + ROWS_PER_PAGE);
    const opening = start ? data.movements[start - 1].balance : cents(byId('sOpening').value);
    const edges = [25, 127, 204, 281, 359, 449, 704];
    box(svg, 25, 197, 679, 26);
    ['الرصيد', 'دائن', 'مدين', 'تاريخ', 'رقم المستند', 'الوصف'].forEach((label, i) => {
      if (i > 0) line(svg, edges[i], 197, edges[i], 223);
      arabic(svg, label, (edges[i] + edges[i + 1]) / 2, 215, { 'font-size': 12, 'font-weight': 700 });
    });
    box(svg, 25, 223, 679, 25);
    arabic(svg, start ? 'الرصيد المرحل' : 'الرصيد الافتتاحي', 531, 240, { 'font-size': 12, 'font-weight': 700 });
    text(svg, money(opening), 421, 240, { 'font-size': 12, 'font-weight': 700 });
    pageRows.forEach((row, index) => {
      const y = 248 + index * 45;
      box(svg, 25, y, 679, 45);
      edges.slice(1, -1).forEach(x => line(svg, x, y, x, y + 45));
      text(svg, money(row.balance), 76, y + 26, { 'data-balance': start + index });
      text(svg, money(row.creditValue), 165.5, y + 26);
      text(svg, money(row.debitValue), 242.5, y + 26);
      multiline(svg, [row.date, row.due].filter(Boolean).join('\n'), 320, y + 22.5, 74, { 'font-size': 10.5 });
      multiline(svg, row.document, 404, y + 22.5, 86, { 'font-size': 10.5 });
      // Arabic and Latin descriptions both keep the reference's right alignment.
      const descriptionLines = String(row.description || '').split('\n');
      descriptionLines.forEach((part, i) => {
        const rtl = /[\u0600-\u06ff]/.test(part);
        const node = (rtl ? arabic : text)(svg, part, 699, y + 25 + (i - (descriptionLines.length - 1) / 2) * Math.min(12, 38 / descriptionLines.length), {
          'text-anchor': rtl ? 'start' : 'end', 'font-size': 10.5
        });
        node.dataset.fitWidth = 243;
      });
    });
    const lastPage = pageIndex === pageCount - 1;
    const totalY = 248 + pageRows.length * 45;
    const pageCredit = pageRows.reduce((sum, row) => sum + row.creditValue, 0);
    const pageDebit = pageRows.reduce((sum, row) => sum + row.debitValue, 0);
    box(svg, 25, totalY, 679, 22, '#e4e9e7');
    arabic(svg, lastPage ? 'الإجمالي' : 'الرصيد المرحل', 634, totalY + 16, { 'font-size': 12, 'font-weight': 700 });
    text(svg, lastPage ? rows.length : pageRows.length, 498, totalY + 16, { 'font-size': 12, 'font-weight': 700, 'data-count': 'movements' });
    text(svg, lastPage ? data.debitCount : pageRows.filter(row => row.debitValue > 0).length, 404, totalY + 16, { 'font-size': 12, 'font-weight': 700, 'data-count': 'debit' });
    text(svg, lastPage ? data.creditCount : pageRows.filter(row => row.creditValue > 0).length, 320, totalY + 16, { 'font-size': 12, 'font-weight': 700, 'data-count': 'credit' });
    text(svg, money(lastPage ? data.debit : pageDebit), 242.5, totalY + 16, { 'font-size': 12, 'font-weight': 700 });
    text(svg, money(lastPage ? data.credit : pageCredit), 165.5, totalY + 16, { 'font-size': 12, 'font-weight': 700 });
    text(svg, money(pageRows.at(-1)?.balance ?? opening), 76, totalY + 16, { 'font-size': 12, 'font-weight': 700, 'data-summary': 'balance' });
    if (lastPage) {
      const words = amountWords(data.balance);
      box(svg, 25, totalY + 22, 679, 23, '#e4e9e7');
      box(svg, 25, totalY + 45, 679, 23, '#e4e9e7');
      const ar = arabic(svg, words.ar, 700, totalY + 38, { 'text-anchor': 'start', 'font-size': 12, 'font-weight': 700 });
      const en = text(svg, words.en, 28, totalY + 61, { 'text-anchor': 'start', 'font-size': 12, 'font-weight': 700 });
      ar.dataset.fitWidth = en.dataset.fitWidth = 670;
      drawAging(svg, data, totalY + 87);
    }
    text(svg, footerDate(outputTime), 32, 1044, { 'text-anchor': 'start', 'font-size': 10.5, 'font-weight': 700, 'data-footer-date': '' });
    drawLogo(svg, DEFAULT_LOGOS.footer, 321, 1030, 78, 24);
    text(svg, 'L: 0    U: 0', 484, 1047, { 'font-size': 11, 'font-weight': 700 });
    text(svg, `Page ${pageIndex + 1} of ${pageCount}`, 699, 1047, { 'text-anchor': 'end', 'font-size': 11, 'font-weight': 700 });
    const sheet = document.createElement('section');
    sheet.className = 'paper statement-sheet';
    sheet.append(svg);
    return sheet;
  }

  function updatePreview() {
    const data = calculate();
    byId('sCounts').textContent = `${rows.length} حركات · ${data.debitCount} مدين · ${data.creditCount} دائن`;
    const pages = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE));
    byId('sPreview').replaceChildren(...Array.from({ length: pages }, (_, index) => renderPage(data, index, pages)));
    fitText();
  }

  function createField(labelText, key, value, type = 'text') {
    const label = document.createElement('label');
    label.append(document.createTextNode(labelText));
    const input = document.createElement(type === 'textarea' ? 'textarea' : 'input');
    if (type === 'textarea') input.rows = 2;
    else input.type = type;
    input.dataset.field = key;
    input.value = value || '';
    if (type === 'number') {
      input.min = '0';
      input.max = '999999999999.99';
      input.step = '0.01';
    }
    label.append(input);
    return label;
  }

  function renderEditors() {
    byId('sRowsEditor').replaceChildren(...rows.map((row, index) => {
      const editor = document.createElement('div');
      editor.className = 'item-editor statement-row';
      editor.dataset.index = index;
      const heading = document.createElement('div');
      heading.className = 'item-head';
      const title = document.createElement('span');
      title.textContent = `الحركة ${index + 1}`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove-item';
      remove.textContent = 'حذف';
      remove.setAttribute('aria-label', `حذف الحركة ${index + 1}`);
      remove.addEventListener('click', () => {
        rows.splice(index, 1);
        renderEditors();
        updatePreview();
        (byId('sRowsEditor').querySelectorAll('.remove-item')[Math.min(index, rows.length - 1)] || byId('sAddRow')).focus();
      });
      heading.append(title, remove);
      editor.append(heading, createField('الوصف', 'description', row.description, 'textarea'), createField('رقم المستند (يمكن استخدام أكثر من سطر)', 'document', row.document, 'textarea'));
      const dates = document.createElement('div');
      dates.className = 'field-grid';
      dates.append(createField('تاريخ الحركة', 'date', row.date, 'date'), createField('تاريخ الاستحقاق (اختياري)', 'due', row.due, 'date'));
      const amounts = document.createElement('div');
      amounts.className = 'field-grid';
      amounts.append(createField('مدين', 'debit', row.debit, 'number'), createField('دائن', 'credit', row.credit, 'number'));
      editor.append(dates, amounts);
      return editor;
    }));
  }

  function validate() {
    byId('sTo').setCustomValidity(byId('sFrom').value && byId('sTo').value < byId('sFrom').value ? 'يجب أن يكون «إلى تاريخ» مساويًا أو لاحقًا لـ «من تاريخ».' : '');
    return byId('statementForm').reportValidity();
  }

  async function embedded(url) {
    if (!embeddedAssets.has(url)) {
      const pending = (async () => {
        const response = await fetch(new URL(url, location.href));
        if (!response.ok) throw new Error(`تعذر تحميل ${url}`);
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      })();
      embeddedAssets.set(url, pending);
      pending.catch(() => embeddedAssets.delete(url));
    }
    return embeddedAssets.get(url);
  }

  async function snapshot() {
    await document.fonts.ready;
    outputTime = new Date();
    updatePreview();
    const pages = [...byId('sPreview').querySelectorAll('svg[role="img"]')].map(svg => svg.cloneNode(true));
    const [regular, bold, latin] = await Promise.all([
      embedded('assets/fonts/Almarai-Regular.ttf'), embedded('assets/fonts/Almarai-Bold.ttf'), embedded('assets/fonts/DAAAAA-ArialMT.ttf')
    ]);
    for (const svg of pages) {
      svg.setAttribute('width', PAGE_WIDTH);
      svg.setAttribute('height', PAGE_HEIGHT);
      const style = element('style', {}, `@font-face{font-family:"Statement Arabic";src:url("${regular}")}@font-face{font-family:"Statement Arabic";src:url("${bold}");font-weight:700}@font-face{font-family:"Statement Arial";src:url("${latin}");font-weight:400 700}`);
      svg.prepend(style);
      await Promise.all([...svg.querySelectorAll('image')].map(async image => {
        const href = image.getAttribute('href');
        if (href && !href.startsWith('data:')) image.setAttribute('href', await embedded(href));
      }));
    }
    return pages;
  }

  async function rasterize(svg) {
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml;charset=utf-8' }));
    try {
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error('تعذر تجهيز صورة الكشف'));
        image.src = url;
      });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(PAGE_WIDTH * DPI_SCALE);
      canvas.height = Math.round(PAGE_HEIGHT * DPI_SCALE);
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('تعذر إنشاء صورة PDF')), 'image/jpeg', 1));
      return new Uint8Array(await blob.arrayBuffer());
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function pdfFromImages(images) {
    const encoder = new TextEncoder();
    const chunks = [];
    const offsets = [0];
    let length = 0;
    const push = value => {
      const bytes = typeof value === 'string' ? encoder.encode(value) : value;
      chunks.push(bytes);
      length += bytes.length;
    };
    const object = (id, values) => {
      offsets[id] = length;
      push(`${id} 0 obj\n`);
      values.forEach(push);
      push('\nendobj\n');
    };
    push('%PDF-1.4\n%PDFGEN\n');
    object(1, ['<< /Type /Catalog /Pages 2 0 R >>']);
    object(2, [`<< /Type /Pages /Kids [${images.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] /Count ${images.length} >>`]);
    images.forEach((jpeg, index) => {
      const pageId = 3 + index * 3;
      object(pageId, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /XObject << /Im0 ${pageId + 1} 0 R >> >> /Contents ${pageId + 2} 0 R >>`]);
      object(pageId + 1, [`<< /Type /XObject /Subtype /Image /Width ${Math.round(PAGE_WIDTH * DPI_SCALE)} /Height ${Math.round(PAGE_HEIGHT * DPI_SCALE)} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, jpeg, '\nendstream']);
      const draw = `q\n${PAGE_WIDTH} 0 0 ${PAGE_HEIGHT} 0 0 cm\n/Im0 Do\nQ\n`;
      object(pageId + 2, [`<< /Length ${encoder.encode(draw).length} >>\nstream\n${draw}endstream`]);
    });
    const xref = length;
    push(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
    offsets.slice(1).forEach(offset => push(`${String(offset).padStart(10, '0')} 00000 n \n`));
    push(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
    return new Blob(chunks, { type: 'application/pdf' });
  }

  function setBusy(value) {
    busy = value;
    byId('statementForm').querySelectorAll('button, input, textarea').forEach(control => { control.disabled = value; });
    byId('sDownload').textContent = value ? 'جارٍ تجهيز المستند…' : 'تنزيل PDF';
  }

  byId('sRowsEditor').addEventListener('input', event => {
    const field = event.target.dataset.field;
    if (!field) return;
    rows[Number(event.target.closest('[data-index]').dataset.index)][field] = event.target.value;
    updatePreview();
  });
  byId('statementForm').addEventListener('submit', event => event.preventDefault());
  byId('statementForm').addEventListener('input', event => {
    if (event.target.closest('#sRowsEditor') || event.target.type === 'file') return;
    if (event.target.id === 'sFrom' || event.target.id === 'sTo') byId('sTo').setCustomValidity('');
    updatePreview();
  });
  byId('sAddRow').addEventListener('click', () => {
    rows.push({ description: '', document: '', date: isoToday(), due: '', debit: '', credit: '' });
    renderEditors();
    updatePreview();
    byId('sRowsEditor').lastElementChild.querySelector('textarea').focus();
  });
  byId('sLogo').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    const version = ++logoReadVersion;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(file.type)) {
      byId('sMessage').textContent = 'اختر صورة PNG أو JPG أو WebP أو SVG للشعار.';
      return;
    }
    try {
      const source = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const image = new Image();
      image.src = source;
      await image.decode();
      if (version !== logoReadVersion) return;
      customLogo = source;
      byId('sMessage').textContent = '';
      updatePreview();
    } catch {
      byId('sMessage').textContent = 'تعذر قراءة الشعار. اختر صورة صالحة.';
    }
  });
  byId('sRestoreLogo').addEventListener('click', () => {
    logoReadVersion++;
    customLogo = '';
    byId('sLogo').value = '';
    updatePreview();
  });
  byId('sReset').addEventListener('click', () => {
    byId('statementForm').reset();
    rows = [];
    byId('sSupplier').value = '';
    byId('sSupplierNo').value = '';
    byId('sFrom').value = isoToday();
    byId('sTo').value = isoToday();
    byId('sTo').setCustomValidity('');
    byId('sMessage').textContent = '';
    customLogo = '';
    logoReadVersion++;
    outputTime = new Date();
    renderEditors();
    updatePreview();
  });
  byId('sDownload').addEventListener('click', async () => {
    if (busy || !validate()) return;
    setBusy(true);
    byId('sMessage').textContent = '';
    try {
      const pages = await snapshot();
      const images = [];
      for (const page of pages) images.push(await rasterize(page));
      const url = URL.createObjectURL(pdfFromImages(images));
      const link = document.createElement('a');
      link.href = url;
      const supplier = byId('sSupplier').value.trim().replace(/[\\/:*?"<>|]+/g, '-');
      link.download = `كشف حساب${supplier ? ` - ${supplier}` : ''} - ${byId('sTo').value}.pdf`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      console.error(error);
      byId('sMessage').textContent = 'تعذر إنشاء PDF. حاول مرة أخرى أو استخدم زر الطباعة.';
    } finally {
      setBusy(false);
    }
  });
  byId('sPrint').addEventListener('click', async () => {
    if (busy || !validate()) return;
    setBusy(true);
    byId('sMessage').textContent = '';
    try {
      await document.fonts.ready;
      await Promise.all([...byId('sPreview').querySelectorAll('image')].map(node => new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = resolve;
        image.onerror = reject;
        image.src = node.getAttribute('href');
      })));
      outputTime = new Date();
      updatePreview();
      window.print();
    } catch (error) {
      console.error(error);
      byId('sMessage').textContent = 'تعذر تجهيز الطباعة. حاول مرة أخرى.';
    } finally {
      setBusy(false);
    }
  });
  window.addEventListener('beforeprint', () => {
    outputTime = new Date();
    updatePreview();
  });
  renderEditors();
  updatePreview();
  document.fonts.ready.then(fitText);
})();
