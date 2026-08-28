const $ = id => document.getElementById(id);
const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_INVOICE_ITEMS = 10;
const INVOICE_ROW_HEIGHT = 37.27;
const INVOICE_BODY_TOP = 247.8;
const INVOICE_FIRST_BASELINE = 263.44;
const INVOICE_FIRST_BOTTOM = 284.64;
const INVOICE_QR_GAP = 4.5;
const PDF_POINTS_PER_INCH = 72;
const PDF_RASTER_DPI = 300;
const PDF_JPEG_QUALITY = 1;
const DOCUMENT_SEQUENCES = {
  invoice: { storageKey: 'invoiceReceipt.nextInvoiceNumber.v1', prefix: 'INV-', start: 11603 },
  receipt: { storageKey: 'invoiceReceipt.nextReceiptNumber.v1', prefix: 'SYS-CUS-PAY-', start: 3902 }
};

const defaults = {
  invoice: {
    customer: '', customerVat: '311166413900003', number: '', date: '', dueDate: '', items: []
  },
  receipt: {
    date: '', amount: '', serial: '', from: '', through: 'الخزنة 100'
  },
  company: {
    name: 'شركة فودز للمواد الغذائية', vat: '311441804500003',
    logo: 'assets/شعار فودز.png', logoLabel: 'شعار فودز.png'
  }
};

let currentDoc = 'invoice';
let items = structuredClone(defaults.invoice.items);
let invoiceDateManuallyEdited = false;
let printDocumentPending = null;
let companyLogoSource = defaults.company.logo;
let companyLogoLabel = defaults.company.logoLabel;
let companyLogoMode = 'automatic';

function localDateValue(date = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function invoiceTimestamp(value) {
  return value ? `${value}T00:00:00Z` : '';
}

function refreshAutomaticInvoiceDate() {
  const today = localDateValue();
  if (!invoiceDateManuallyEdited && document.activeElement !== $('fInvoiceDate')) {
    $('fInvoiceDate').value = today;
  }
  if (document.activeElement !== $('fDueDate')) $('fDueDate').value = today;
  updateInvoice();
}

function refreshAutomaticReceiptDate() {
  $('rDate').value = localDateValue();
  updateReceipt();
}

function sequenceValue(documentName) {
  const config = DOCUMENT_SEQUENCES[documentName];
  try {
    const stored = Number.parseInt(localStorage.getItem(config.storageKey), 10);
    return Number.isSafeInteger(stored) && stored >= config.start ? stored : config.start;
  } catch (error) {
    console.warn('تعذر قراءة تسلسل المستندات من التخزين المحلي.', error);
    return config.start;
  }
}

function sequenceIdentifier(documentName) {
  const config = DOCUMENT_SEQUENCES[documentName];
  return `${config.prefix}${sequenceValue(documentName)}`;
}

function applyCurrentSequence(documentName) {
  if (documentName === 'invoice') {
    $('fInvoiceNo').value = sequenceIdentifier(documentName);
    updateInvoice();
  } else {
    $('rSerial').value = sequenceIdentifier(documentName);
    updateReceipt();
  }
}

function advanceSequence(documentName) {
  const config = DOCUMENT_SEQUENCES[documentName];
  const nextValue = sequenceValue(documentName) + 1;
  try {
    localStorage.setItem(config.storageKey, String(nextValue));
  } catch (error) {
    console.warn('تعذر حفظ تسلسل المستندات في التخزين المحلي.', error);
  }
  applyCurrentSequence(documentName);
}

function number(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value) {
  return number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function sameNumber(a, b) {
  return Math.abs(number(a) - number(b)) < 0.00001;
}

function setPatch(id, changed) {
  $(id).classList.toggle('changed', changed);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]);
}

function updateCompanyLogo() {
  const visible = Boolean(companyLogoSource);
  ['invoiceCompanyLogo', 'receiptCompanyLogo'].forEach(id => {
    $(id).style.display = visible ? 'block' : 'none';
  });
  ['invoiceCompanyLogoImage', 'receiptCompanyLogoImage'].forEach(id => {
    if (visible) $(id).setAttribute('href', companyLogoSource);
    else $(id).removeAttribute('href');
  });
  $('companyLogoStatus').textContent = visible
    ? companyLogoLabel
    : 'لا يوجد شعار — سيُستخدم القالب الحالي';
  $('removeCompanyLogo').disabled = !visible;
}

function syncAutomaticCompanyLogo() {
  if (companyLogoMode !== 'automatic') return;
  const isFoodsCompany = $('fCompanyName').value.trim() === defaults.company.name;
  companyLogoSource = isFoodsCompany ? defaults.company.logo : '';
  companyLogoLabel = isFoodsCompany ? defaults.company.logoLabel : '';
  updateCompanyLogo();
}

function loadCompanyLogo(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    alert('اختر ملف صورة صالحًا لشعار الشركة.');
    $('fCompanyLogo').value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    companyLogoSource = String(reader.result);
    companyLogoLabel = file.name;
    companyLogoMode = 'custom';
    updateCompanyLogo();
  };
  reader.onerror = () => alert('تعذر قراءة ملف الشعار. حاول اختيار الملف مرة أخرى.');
  reader.readAsDataURL(file);
}

function renderEditors() {
  $('itemsEditor').innerHTML = items.map((item, index) => `
    <div class="item-editor" data-index="${index}">
      <div class="item-head">
        <span>الصنف ${index + 1}</span>
        <button type="button" class="remove-item">حذف</button>
      </div>
      <label>الوصف / الصنف<input class="item-description" value="${escapeHtml(item.description)}"></label>
      <div class="field-grid">
        <label>الكمية<input class="item-quantity" type="number" min="0" step="1" value="${item.quantity}"></label>
        <label>سعر الوحدة شامل الضريبة<input class="item-price" type="number" min="0" step="0.01" value="${item.price}"></label>
      </div>
      <label>نسبة الضريبة %<input class="item-vat" type="number" min="0" step="0.01" value="${item.vat}"></label>
    </div>`).join('');

  document.querySelectorAll('.item-editor').forEach(editor => {
    const index = Number(editor.dataset.index);
    editor.querySelector('.item-description').addEventListener('input', event => { items[index].description = event.target.value; updateInvoice(); });
    editor.querySelector('.item-quantity').addEventListener('input', event => { items[index].quantity = number(event.target.value); updateInvoice(); });
    editor.querySelector('.item-price').addEventListener('input', event => { items[index].price = number(event.target.value); updateInvoice(); });
    editor.querySelector('.item-vat').addEventListener('input', event => { items[index].vat = number(event.target.value); updateInvoice(); });
    const remove = editor.querySelector('.remove-item');
    if (remove) remove.addEventListener('click', () => { items.splice(index, 1); renderEditors(); updateInvoice(); });
  });

  $('addItem').disabled = items.length >= MAX_INVOICE_ITEMS;
  $('addItem').textContent = items.length >= MAX_INVOICE_ITEMS ? 'الحد الأقصى 10 أصناف' : 'إضافة صنف';
}

function svgElement(tag, attributes = {}, text = '') {
  const element = document.createElementNS(SVG_NS, tag);
  Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, value));
  if (text !== '') element.textContent = text;
  return element;
}

function addTemplateCrop(group, x, sourceY, width, height, shift) {
  const crop = svgElement('svg', {
    x,
    y: sourceY + shift,
    width,
    height,
    viewBox: `${x} ${sourceY} ${width} ${height}`,
    preserveAspectRatio: 'none',
    overflow: 'hidden'
  });
  crop.append(svgElement('image', {
    href: 'assets/invoice-template.svg',
    x: 0,
    y: 0,
    width: 595.92,
    height: 841.92,
    preserveAspectRatio: 'none'
  }));
  group.append(crop);
}

function renderInvoiceRows(changed) {
  const group = $('patchItems');
  group.replaceChildren();
  group.classList.toggle('changed', changed);
  const shift = Math.max(0, items.length - 1) * INVOICE_ROW_HEIGHT;
  if (!changed) return shift;

  // Remove the original one-row body, totals and QR block. Exact template crops
  // are then restored below the expanded rows at the offset used by the
  // multi-product PDF reference.
  group.append(svgElement('rect', { x: 28.5, y: INVOICE_BODY_TOP, width: 550, height: 130.5, fill: '#fff' }));
  addTemplateCrop(group, 45, 294, 266, 62, shift);
  // Restore only the QR explanatory note. Starting below the table border
  // prevents a second copy of the last-row line from moving down with the QR.
  addTemplateCrop(group, 380, 362, 199, 16, shift + INVOICE_QR_GAP);

  const bodyBottom = INVOICE_FIRST_BOTTOM + shift;
  group.append(svgElement('path', {
    d: `M30.24 ${INVOICE_BODY_TOP} V${bodyBottom} H577.31 V${INVOICE_BODY_TOP}`,
    fill: 'none',
    stroke: '#cbd5e1',
    'stroke-width': '.695'
  }));

  items.forEach((item, index) => {
    const gross = number(item.quantity) * number(item.price);
    const taxable = item.vat ? gross / (1 + number(item.vat) / 100) : gross;
    const vat = gross - taxable;
    const baseline = INVOICE_FIRST_BASELINE + INVOICE_ROW_HEIGHT * index;
    const secondaryBaseline = baseline + 11.12;
    const common = { 'font-family': 'PDF Arial, Arial, sans-serif', 'font-size': 8.34091, fill: '#000', 'text-anchor': 'middle' };

    group.append(svgElement('text', { ...common, x: 571, y: baseline }, index + 1));
    group.append(svgElement('text', { ...common, x: 520, y: baseline, 'font-family': 'Arabic Full, Arial, sans-serif', direction: 'rtl', 'unicode-bidi': 'embed', lang: 'ar' }, item.description));
    group.append(svgElement('text', { ...common, x: 360, y: baseline }, number(item.quantity)));
    group.append(svgElement('text', { ...common, x: 305, y: baseline }, money(item.price)));
    group.append(svgElement('text', { ...common, x: 237, y: baseline }, money(taxable)));
    group.append(svgElement('text', { ...common, x: 144, y: baseline }, money(vat)));
    group.append(svgElement('text', { ...common, x: 144, y: secondaryBaseline }, `${number(item.vat)}%`));
    group.append(svgElement('text', { ...common, x: 73, y: baseline }, money(gross)));

    if (index < items.length - 1) {
      const y = INVOICE_FIRST_BOTTOM + INVOICE_ROW_HEIGHT * index;
      group.append(svgElement('line', { x1: 30.59, y1: y, x2: 576.95, y2: y, stroke: '#cbd5e1', 'stroke-width': '.695' }));
    }
  });

  return shift;
}

function setInvoiceDownstreamShift(shift) {
  ['patchSubtotal', 'patchVatTotal', 'patchGrandTotal'].forEach(id => {
    if (shift) $(id).setAttribute('transform', `translate(0 ${shift})`);
    else $(id).removeAttribute('transform');
  });
  $('patchInvoiceQr').setAttribute('transform', `translate(0 ${shift + INVOICE_QR_GAP})`);
}

function tlv(tag, value) {
  const encoded = new TextEncoder().encode(String(value));
  const result = new Uint8Array(encoded.length + 2);
  result[0] = tag;
  result[1] = encoded.length;
  result.set(encoded, 2);
  return result;
}

function base64(bytes) {
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function qrDataUrl(payload) {
  if (typeof QRCode === 'undefined') throw new Error('تعذر تحميل مولد رمز QR');
  const holder = document.createElement('div');
  const qrCode = new QRCode(holder, {
    text: payload,
    width: 128,
    height: 128,
    colorDark: '#000000',
    colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.M
  });
  const model = qrCode._oQRCode;
  const moduleCount = model.getModuleCount();
  const quietZone = 4;
  const moduleSize = 8;
  const canvas = document.createElement('canvas');
  canvas.width = (moduleCount + quietZone * 2) * moduleSize;
  canvas.height = canvas.width;
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#000';
  for (let row = 0; row < moduleCount; row += 1) {
    for (let column = 0; column < moduleCount; column += 1) {
      if (model.isDark(row, column)) {
        context.fillRect(
          (column + quietZone) * moduleSize,
          (row + quietZone) * moduleSize,
          moduleSize,
          moduleSize
        );
      }
    }
  }
  return canvas.toDataURL('image/png');
}

function setFittedSvgText(id, value, maxWidth, baseFontSize, minimumFontSize) {
  const element = $(id);
  element.textContent = value;
  element.style.fontSize = `${baseFontSize}px`;
  element.removeAttribute('textLength');
  element.removeAttribute('lengthAdjust');
  const measuredWidth = element.getComputedTextLength();
  if (measuredWidth > maxWidth) {
    const fittedSize = Math.max(minimumFontSize, baseFontSize * maxWidth / measuredWidth);
    element.style.fontSize = `${fittedSize}px`;
    if (element.getComputedTextLength() > maxWidth) {
      element.setAttribute('textLength', maxWidth);
      element.setAttribute('lengthAdjust', 'spacingAndGlyphs');
    }
  }
}

function updateCompanyName() {
  const value = $('fCompanyName').value.trim();
  setFittedSvgText('invoiceCompanyLeft', value, 164, 14, 8);
  setFittedSvgText('invoiceCompanyRight', value, 170, 14, 8);
  setFittedSvgText('invoiceCompanyFooter', value, 106, 6.5, 5);
  setFittedSvgText('receiptCompanyLeft', value, 149, 14, 8);
  setFittedSvgText('receiptCompanyRight', value, 154, 14, 8);
  setFittedSvgText('receiptCompanyFooter', value, 80, 6.5, 5);
  ['patchInvoiceCompanyLeft', 'patchInvoiceCompanyRight', 'patchInvoiceCompanyFooter',
    'patchReceiptCompanyLeft', 'patchReceiptCompanyRight', 'patchReceiptCompanyFooter']
    .forEach(id => setPatch(id, true));
}

function updateInvoiceQr(total, vat, visible) {
  setPatch('patchInvoiceQr', true);
  $('invoiceQr').style.display = visible ? 'block' : 'none';
  if (!visible) {
    $('invoiceQr').removeAttribute('href');
    return;
  }
  const parts = [
    tlv(1, $('fCompanyName').value.trim()),
    tlv(2, $('fCustomerVat').value.trim()),
    tlv(3, invoiceTimestamp($('fInvoiceDate').value)),
    tlv(4, money(total).replaceAll(',', '')),
    tlv(5, money(vat).replaceAll(',', ''))
  ];
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const combined = new Uint8Array(length);
  let offset = 0;
  parts.forEach(part => { combined.set(part, offset); offset += part.length; });
  const payload = base64(combined);
  $('invoiceQr').setAttribute('href', qrDataUrl(payload));
}

function updateInvoice() {
  updateCompanyName();
  const values = {
    customer: $('fCustomer').value, customerVat: $('fCustomerVat').value,
    number: $('fInvoiceNo').value, date: $('fInvoiceDate').value, dueDate: $('fDueDate').value
  };

  $('vCustomer').textContent = values.customer;
  $('vCustomerVat').textContent = values.customerVat;
  $('vInvoiceNo').textContent = values.number;
  $('vInvoiceDate').textContent = values.date;
  $('vDueDate').textContent = values.dueDate;
  $('footerInvoiceNo').textContent = values.number;
  $('headerVatLeft').textContent = values.customerVat;
  $('headerVatRight').textContent = values.customerVat;

  ['patchCustomer', 'patchCustomerVat', 'patchInvoiceNo', 'patchFooterInvoiceNo',
    'patchInvoiceDate', 'patchDueDate', 'patchHeaderVatLeft', 'patchHeaderVatRight']
    .forEach(id => setPatch(id, true));

  let taxableTotal = 0;
  let vatTotal = 0;
  let grandTotal = 0;
  items.forEach(item => {
    const gross = number(item.quantity) * number(item.price);
    const taxable = item.vat ? gross / (1 + number(item.vat) / 100) : gross;
    taxableTotal += taxable;
    vatTotal += gross - taxable;
    grandTotal += gross;
  });

  const downstreamShift = renderInvoiceRows(true);
  setInvoiceDownstreamShift(downstreamShift);
  $('subtotal').textContent = money(taxableTotal);
  $('vatTotal').textContent = money(vatTotal);
  $('grandTotal').textContent = money(grandTotal);
  setPatch('patchSubtotal', true);
  setPatch('patchVatTotal', true);
  setPatch('patchGrandTotal', true);
  updateInvoiceQr(grandTotal, vatTotal, Boolean(
    $('fCompanyName').value.trim() && values.date && values.customerVat.trim() && items.length
  ));

  // بيانات سند القبض تتبع الفاتورة الحالية مباشرة.
  $('rFrom').value = values.customer;
  $('rAmount').value = grandTotal ? grandTotal.toFixed(2) : '';
  updateReceipt();
}

function updateReceipt() {
  updateCompanyName();
  const values = {
    date: $('rDate').value, amount: number($('rAmount').value), serial: $('rSerial').value,
    from: $('rFrom').value, through: $('rThrough').value
  };

  $('vrDate').textContent = values.date;
  $('vrAmount').textContent = money(values.amount).replaceAll(',', '');
  $('vrSerial').textContent = values.serial;
  $('vrFrom').textContent = values.from;
  $('vrThrough').textContent = values.through;
  $('footerSerial').textContent = values.serial;

  ['patchReceiptDate', 'patchReceiptAmount', 'patchReceiptSerial',
    'patchFooterSerial', 'patchReceiptFrom', 'patchReceiptThrough']
    .forEach(id => setPatch(id, true));
}

function setDocument(documentName) {
  currentDoc = documentName;
  document.querySelectorAll('.tab').forEach(tab => {
    const active = tab.dataset.tab === documentName;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', active);
  });
  $('invoiceForm').classList.toggle('active', documentName === 'invoice');
  $('receiptForm').classList.toggle('active', documentName === 'receipt');
  $('invoicePaper').style.display = documentName === 'invoice' ? 'block' : 'none';
  $('receiptPaper').style.display = documentName === 'receipt' ? 'block' : 'none';
  $('invoicePaper').classList.toggle('print-active', documentName === 'invoice');
  $('receiptPaper').classList.toggle('print-active', documentName === 'receipt');
  updateCompanyName();
  if (documentName === 'receipt') refreshAutomaticReceiptDate();
}

function reset() {
  $('fCompanyName').value = defaults.company.name;
  $('fCustomer').value = defaults.invoice.customer;
  $('fCustomerVat').value = defaults.invoice.customerVat;
  $('fInvoiceNo').value = sequenceIdentifier('invoice');
  invoiceDateManuallyEdited = false;
  $('fInvoiceDate').value = localDateValue();
  $('fDueDate').value = localDateValue();
  items = structuredClone(defaults.invoice.items);
  $('rDate').value = localDateValue();
  $('rAmount').value = defaults.receipt.amount;
  $('rSerial').value = sequenceIdentifier('receipt');
  $('rFrom').value = defaults.receipt.from;
  $('rThrough').value = defaults.receipt.through;
  $('fCompanyLogo').value = '';
  companyLogoMode = 'automatic';
  syncAutomaticCompanyLogo();
  renderEditors();
  updateInvoice();
  updateReceipt();
}

function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

async function urlToDataUrl(url) {
  const response = await fetch(new URL(url, window.location.href));
  if (!response.ok) throw new Error(`تعذر تحميل ${url}`);
  const blob = await response.blob();
  return `data:${blob.type || 'application/octet-stream'};base64,${bufferToBase64(await blob.arrayBuffer())}`;
}

async function inlineOverlayImages(svg) {
  await Promise.all([...svg.querySelectorAll('image')].map(async element => {
    const href = element.getAttribute('href');
    if (!href || href.startsWith('data:')) return;
    element.setAttribute('href', await urlToDataUrl(href));
  }));
}

async function documentSvg(documentName) {
  await document.fonts.ready;
  const invoice = documentName === 'invoice';
  const width = 595.92;
  const height = invoice ? 841.92 : 420;
  const templateUrl = invoice ? 'assets/invoice-template.svg' : 'assets/receipt-template.svg';
  const overlay = $(invoice ? 'invoicePaper' : 'receiptPaper').querySelector('.document-overlay').cloneNode(true);
  overlay.removeAttribute('aria-hidden');
  overlay.setAttribute('width', width);
  overlay.setAttribute('height', height);
  await inlineOverlayImages(overlay);

  const [template, arRegular, arBold, pdfArial, pdfWafeq] = await Promise.all([
    urlToDataUrl(templateUrl),
    urlToDataUrl('assets/fonts/Almarai-Regular.ttf'),
    urlToDataUrl('assets/fonts/Almarai-Bold.ttf'),
    urlToDataUrl('assets/fonts/DAAAAA-ArialMT.ttf'),
    urlToDataUrl('assets/fonts/BAAAAA-Wafeq-Regular.ttf')
  ]);

  const style = `
    @font-face{font-family:"Arabic Full";src:url("${arRegular}") format("truetype");font-weight:400}
    @font-face{font-family:"Arabic Full";src:url("${arBold}") format("truetype");font-weight:600 800}
    @font-face{font-family:"PDF Arial";src:url("${pdfArial}") format("truetype")}
    @font-face{font-family:"PDF Wafeq";src:url("${pdfWafeq}") format("truetype")}
    .document-overlay{width:100%;height:100%;overflow:visible}
    .patch{display:none}.patch.changed{display:block}.patch rect{fill:#fff}
    .pdf-latin{font-family:"PDF Arial",Arial,sans-serif}.pdf-ar{font-family:"Arabic Full",Arial,sans-serif;direction:rtl;unicode-bidi:embed}
    .company-name{font-family:"Arabic Full",Arial,sans-serif;font-size:14px;font-weight:700;fill:#000;direction:rtl;unicode-bidi:embed}.company-footer{font-size:6.5px;font-weight:400}
    .value{font-size:8.34091px;font-weight:400;fill:#000}.total-value{font-size:8.34091px;font-weight:700;fill:#000}.footer-value{font-size:7.5px;font-weight:400;fill:#000}
    .receipt-patch rect{fill:#fff}.receipt-latin{font-family:"PDF Wafeq","PDF Arial",Arial,sans-serif}.receipt-ar{font-family:"Arabic Full",Arial,sans-serif;direction:rtl;unicode-bidi:embed}.receipt-company-name{fill:#354058}
    .receipt-value{font-size:9px;font-weight:400;fill:#354058}.receipt-footer{font-size:7.5px;font-weight:400;fill:#000}
  `;
  return {
    width,
    height,
    source: `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><style>${style}</style><image href="${template}" width="${width}" height="${height}" preserveAspectRatio="none"/>${overlay.outerHTML}</svg>`
  };
}

async function svgToJpeg(svgDocument) {
  const svgBlob = new Blob([svgDocument.source], { type: 'image/svg+xml;charset=utf-8' });
  const svgUrl = URL.createObjectURL(svgBlob);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('تعذر تجهيز صورة المستند'));
      image.src = svgUrl;
    });
    // PDF dimensions use points (72 points per inch). Render at a true
    // print resolution so fine text, rules and the QR code remain sharp.
    const scale = PDF_RASTER_DPI / PDF_POINTS_PER_INCH;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(svgDocument.width * scale);
    canvas.height = Math.round(svgDocument.height * scale);
    const context = canvas.getContext('2d', { alpha: false });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) => canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('تعذر إنشاء صورة PDF')),
      'image/jpeg',
      PDF_JPEG_QUALITY
    ));
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

function joinBytes(parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  parts.forEach(part => { result.set(part, offset); offset += part.length; });
  return result;
}

async function jpegToPdf(jpegBlob, pageWidth, pageHeight, imageWidth, imageHeight) {
  const encoder = new TextEncoder();
  const jpeg = new Uint8Array(await jpegBlob.arrayBuffer());
  const chunks = [];
  const offsets = [0];
  let byteLength = 0;
  const push = value => {
    const bytes = typeof value === 'string' ? encoder.encode(value) : value;
    chunks.push(bytes);
    byteLength += bytes.length;
  };
  const object = (number, bodyParts) => {
    offsets[number] = byteLength;
    push(`${number} 0 obj\n`);
    bodyParts.forEach(push);
    push('\nendobj\n');
  };

  push('%PDF-1.4\n%PDFGEN\n');
  object(1, ['<< /Type /Catalog /Pages 2 0 R >>']);
  object(2, ['<< /Type /Pages /Kids [3 0 R] /Count 1 >>']);
  object(3, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`]);
  object(4, [
    `<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
    jpeg,
    '\nendstream'
  ]);
  const drawing = `q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/Im0 Do\nQ\n`;
  object(5, [`<< /Length ${encoder.encode(drawing).length} >>\nstream\n${drawing}endstream`]);

  const xrefOffset = byteLength;
  push('xref\n0 6\n0000000000 65535 f \n');
  for (let index = 1; index <= 5; index += 1) {
    push(`${String(offsets[index]).padStart(10, '0')} 00000 n \n`);
  }
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
  return new Blob([joinBytes(chunks)], { type: 'application/pdf' });
}

async function buildPdfBlob(documentName = currentDoc) {
  const svg = await documentSvg(documentName);
  const jpeg = await svgToJpeg(svg);
  return jpegToPdf(
    jpeg,
    svg.width,
    svg.height,
    Math.round(svg.width * PDF_RASTER_DPI / PDF_POINTS_PER_INCH),
    Math.round(svg.height * PDF_RASTER_DPI / PDF_POINTS_PER_INCH)
  );
}

function safeFileName(value, fallback) {
  const cleaned = String(value || '').trim().replace(/[\\/:*?"<>|]+/g, '-');
  return cleaned || fallback;
}

async function downloadCurrentPdf() {
  const button = $('downloadPdf');
  const originalText = button.textContent;
  const issuedDocument = currentDoc;
  button.disabled = true;
  button.textContent = 'جارٍ إنشاء PDF…';
  try {
    if (issuedDocument === 'invoice') refreshAutomaticInvoiceDate();
    else refreshAutomaticReceiptDate();
    const pdf = await buildPdfBlob(issuedDocument);
    const identifier = issuedDocument === 'invoice' ? $('fInvoiceNo').value : $('rSerial').value;
    const fallback = issuedDocument === 'invoice' ? 'invoice' : 'receipt';
    const url = URL.createObjectURL(pdf);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${safeFileName(identifier, fallback)}.pdf`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    advanceSequence(issuedDocument);
  } catch (error) {
    console.error(error);
    alert('تعذر إنشاء ملف PDF. أعد تحميل الصفحة ثم حاول مرة أخرى.');
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => setDocument(tab.dataset.tab)));
$('addItem').addEventListener('click', () => {
  if (items.length >= MAX_INVOICE_ITEMS) return;
  items.push({ description: '', quantity: 1, price: 0, vat: 15 });
  renderEditors();
  updateInvoice();
});
['fCustomer', 'fCustomerVat', 'fInvoiceNo', 'fDueDate'].forEach(id => $(id).addEventListener('input', updateInvoice));
$('fCompanyName').addEventListener('input', () => {
  syncAutomaticCompanyLogo();
  updateInvoice();
  updateReceipt();
});
$('fCompanyLogo').addEventListener('change', event => loadCompanyLogo(event.target.files[0]));
$('removeCompanyLogo').addEventListener('click', () => {
  companyLogoSource = '';
  companyLogoLabel = '';
  companyLogoMode = 'none';
  $('fCompanyLogo').value = '';
  updateCompanyLogo();
});
$('fInvoiceDate').addEventListener('input', () => {
  invoiceDateManuallyEdited = true;
  updateInvoice();
});
['rDate', 'rAmount', 'rSerial', 'rFrom', 'rThrough'].forEach(id => $(id).addEventListener('input', updateReceipt));
$('resetBtn').addEventListener('click', reset);
$('downloadPdf').addEventListener('click', downloadCurrentPdf);
$('printBtn').addEventListener('click', () => {
  if (currentDoc === 'invoice') refreshAutomaticInvoiceDate();
  else refreshAutomaticReceiptDate();
  let rule = $('pageRule');
  if (!rule) { rule = document.createElement('style'); rule.id = 'pageRule'; document.head.append(rule); }
  rule.textContent = currentDoc === 'invoice'
    ? '@page{size:210.227mm 297.011mm;margin:0}'
    : '@page{size:210.227mm 148.167mm;margin:0}';
  printDocumentPending = currentDoc;
  window.print();
});

window.addEventListener('afterprint', () => {
  if (!printDocumentPending) return;
  const issuedDocument = printDocumentPending;
  printDocumentPending = null;
  advanceSequence(issuedDocument);
});

window.addEventListener('storage', event => {
  const documentName = Object.keys(DOCUMENT_SEQUENCES)
    .find(name => DOCUMENT_SEQUENCES[name].storageKey === event.key);
  if (documentName) applyCurrentSequence(documentName);
});

renderEditors();
$('fCustomerVat').value = defaults.invoice.customerVat;
$('fInvoiceDate').value = localDateValue();
$('fDueDate').value = localDateValue();
$('rDate').value = localDateValue();
$('fInvoiceNo').value = sequenceIdentifier('invoice');
$('rSerial').value = sequenceIdentifier('receipt');
$('rThrough').value = defaults.receipt.through;
updateCompanyLogo();
updateInvoice();
updateReceipt();
setDocument('invoice');
