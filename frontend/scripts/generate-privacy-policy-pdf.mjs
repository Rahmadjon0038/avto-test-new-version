import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const INPUT = path.join(ROOT, "data", "privacy-policy.json");
const OUTPUT = path.join(ROOT, "public", "privacy-policy.pdf");

const policy = JSON.parse(fs.readFileSync(INPUT, "utf8"));

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

function normalizeText(value) {
  return String(value)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u00A0/g, " ");
}

function escapePdfText(value) {
  return normalizeText(value)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function wrapText(text, maxChars) {
  const normalized = normalizeText(text).trim();
  if (!normalized) return [""];
  const words = normalized.split(/\s+/);
  const lines = [];
  let current = "";
  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }
    if ((current + " " + word).length <= maxChars) {
      current += " " + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [normalized];
}

function buildElements() {
  const elements = [];
  const addLine = (text, size = 11.2, font = "F1", indent = 0, leading = 1.35) => {
    const maxChars = Math.max(24, Math.floor((CONTENT_WIDTH - indent) / (size * 0.55)));
    const lines = wrapText(text, maxChars);
    lines.forEach((line, index) => {
      elements.push({
        text: line,
        size,
        font,
        indent,
        lineHeight: size * leading,
        before: index === 0 ? size * 0.15 : 0
      });
    });
  };

  const addParagraph = (text, size = 11.2, indent = 0) => {
    const paras = String(text)
      .split(/\n+/)
      .map((part) => part.trim())
      .filter(Boolean);
    paras.forEach((para, index) => {
      if (index > 0) elements.push({ spacer: size * 0.35 });
      addLine(para, size, "F1", indent, 1.45);
    });
  };

  elements.push({ text: policy.title, size: 21, font: "F2", indent: 0, lineHeight: 28, before: 0 });
  elements.push({ text: `Oxirgi yangilanish: ${policy.lastUpdatedLabel}`, size: 10.3, font: "F1", indent: 0, lineHeight: 15, before: 3 });
  elements.push({ spacer: 10 });
  addParagraph(policy.intro.join("\n\n"), 11.1);
  elements.push({ spacer: 8 });
  elements.push({ text: "Asosiy tamoyillar", size: 15, font: "F2", indent: 0, lineHeight: 20, before: 8 });
  policy.highlights.forEach((item) => {
    addLine(`• ${item.title} — ${item.text}`, 11.0, "F1", 8, 1.42);
  });
  elements.push({ spacer: 10 });

  policy.sections.forEach((section) => {
    elements.push({ text: section.title, size: 14, font: "F2", indent: 0, lineHeight: 18, before: 8 });
    section.items.forEach((item) => {
      addLine(`- ${item}`, 11.0, "F1", 10, 1.42);
    });
    elements.push({ spacer: 8 });
  });

  elements.push({ text: "Aloqa", size: 14, font: "F2", indent: 0, lineHeight: 18, before: 8 });
  addLine(`Email: ${policy.contact.email}`, 11.0, "F1", 0, 1.42);
  addLine(`Website: ${policy.contact.website}`, 11.0, "F1", 0, 1.42);

  return elements;
}

function paginate(elements) {
  const pages = [];
  let current = [];
  let y = PAGE_HEIGHT - MARGIN;

  const pushPage = () => {
    if (current.length) pages.push(current);
    current = [];
    y = PAGE_HEIGHT - MARGIN;
  };

  for (const element of elements) {
    if (element.spacer) {
      y -= element.spacer;
      continue;
    }

    const lineHeight = element.lineHeight || 14;
    const before = element.before || 0;
    y -= before;
    if (y - lineHeight < MARGIN) {
      pushPage();
      y -= before;
    }

    current.push({
      text: element.text,
      size: element.size,
      font: element.font,
      x: MARGIN + (element.indent || 0),
      y
    });
    y -= lineHeight;
  }

  if (current.length) pages.push(current);
  return pages;
}

function buildPdf(pages) {
  const objects = [];

  const addObject = (content) => {
    objects.push(content);
    return objects.length;
  };

  const catalogIndex = addObject(null);
  const pagesIndex = addObject(null);
  const fontRegularIndex = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const fontBoldIndex = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");

  const pageIndexes = [];
  const contentIndexes = [];

  for (const page of pages) {
    const lines = [];
    for (const item of page) {
      lines.push(`BT /${item.font} ${item.size.toFixed(2)} Tf ${item.x.toFixed(2)} ${item.y.toFixed(2)} Td (${escapePdfText(item.text)}) Tj ET`);
    }
    const contentStream = lines.join("\n");
    contentIndexes.push(addObject(`<< /Length ${Buffer.byteLength(contentStream, "latin1")} >>\nstream\n${contentStream}\nendstream`));
    pageIndexes.push(addObject(null));
  }

  const kids = pageIndexes.map((index) => `${index} 0 R`).join(" ");
  objects[pagesIndex - 1] = `<< /Type /Pages /Kids [${kids}] /Count ${pageIndexes.length} >>`;
  objects[catalogIndex - 1] = `<< /Type /Catalog /Pages ${pagesIndex} 0 R >>`;

  pageIndexes.forEach((pageIndex, pageNumber) => {
    const contentIndex = contentIndexes[pageNumber];
    objects[pageIndex - 1] = `<< /Type /Page /Parent ${pagesIndex} 0 R /MediaBox [0 0 ${PAGE_WIDTH.toFixed(2)} ${PAGE_HEIGHT.toFixed(2)}] /Resources << /Font << /F1 ${fontRegularIndex} 0 R /F2 ${fontBoldIndex} 0 R >> >> /Contents ${contentIndex} 0 R >>`;
  });

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xrefStart = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += `0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogIndex} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

const elements = buildElements();
const pages = paginate(elements);
const pdf = buildPdf(pages);

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, pdf);

console.log(`Generated ${OUTPUT} with ${pages.length} page(s).`);
