import { regionName, regions, type SavedMap } from "./types.ts";
import {
  stringifyNotebook,
  exportNotebook,
  aiPrompt,
} from "./notebook-data.ts";
import type { ViewportCapture } from "./anatomy/capture";
import { intensityColor } from "./anatomy/intensity.ts";
import { saveExport } from "./platform/files.ts";
import { formatDate, language, t } from "./i18n/index.ts";

const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
function wrap(text: string, width = 55) {
  const words = text
    .split(/\s+/)
    .flatMap((word) => word.match(new RegExp(`.{1,${width}}`, "g")) ?? []);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if ((line + word).length > width && line) {
      lines.push(line.trim());
      line = "";
    }
    line += `${word} `;
  }
  if (line) lines.push(line.trim());
  return lines;
}
const textLines = (
  lines: string[],
  x: number,
  y: number,
  size = 16,
  step = 25,
) =>
  lines
    .map(
      (line, i) =>
        `<text x="${x}" y="${y + i * step}" font-size="${size}">${escape(line)}</text>`,
    )
    .join("");
export function renderMapSvg(map: SavedMap) {
  const regionLines = wrap(
    map.map.regions.map(regionName).join(", ") || t("export.notSpecified"),
  );
  const summaryTop = 350 + (regionLines.length - 1) * 24;
  const summaryLines = wrap(map.map.summary);
  const facts = wrap(
    [
      map.map.quality && t("export.svg.feeling", { value: map.map.quality }),
      map.map.activity && t("export.svg.activity", { value: map.map.activity }),
      map.map.duration && t("export.svg.timing", { value: map.map.duration }),
      map.map.intensity !== null &&
        t("export.svg.intensity", { value: map.map.intensity }),
    ]
      .filter(Boolean)
      .join(" ") || t("export.svg.noContext"),
  );
  const factsTop = summaryTop + summaryLines.length * 25 + 34;
  let pinY = 670;
  const pinLabels = (map.points ?? [])
    .map((point, i) => {
      const lines = wrap(
        `${i + 1}. ${regionName(point.region)} — ${point.structure}${point.comment ? `. ${point.comment}` : ""}`,
        37,
      );
      const markup = textLines(lines, 55, pinY, 12, 19);
      pinY += lines.length * 19 + 12;
      return markup;
    })
    .join("");
  const referenceTop = Math.max(745, pinY, factsTop + facts.length * 25) + 40;
  let referenceY = referenceTop + 31;
  const references = (map.references ?? [])
    .filter((r) => r.url.startsWith("https://"))
    .map((reference, i) => {
      const lines = wrap(
        `[${i + 1}] ${reference.publisher}: ${reference.title}`,
        108,
      );
      const markup = `<a href="${escape(reference.url)}">${textLines(lines, 55, referenceY, 14, 21)}</a>`;
      referenceY += lines.length * 21 + 8;
      const urls = wrap(reference.url, 130);
      const address = textLines(urls, 75, referenceY, 10, 15);
      referenceY += urls.length * 15 + 25;
      return markup + address;
    })
    .join("");
  const height = Math.max(960, referenceY + 165);
  const circles = map.map.regions
    .filter((id) => !map.points?.some((p) => p.region === id))
    .map((id) => {
      const r = regions.find((r) => r.id === id);
      if (!r) return "";
      const back = id.includes("back");
      return `<circle cx="${(back ? 283 : 119) + r.center[0] * (back ? -46 : 46)}" cy="${465 - r.center[1] * 46}" r="23" fill="url(#heat)"/>`;
    })
    .join("");
  const points = (map.points ?? [])
    .map((point, i) => {
      const back = point.position[2] < 0,
        x = (back ? 283 : 119) + point.position[0] * (back ? -46 : 46),
        y = 465 - point.position[1] * 46;
      return `<circle cx="${x}" cy="${y}" r="18" fill="url(#heat)"/><circle cx="${x}" cy="${y}" r="8" fill="#8a4527"/><text x="${x}" y="${y + 3}" text-anchor="middle" font-size="9" fill="white">${i + 1}</text>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="${height}" viewBox="0 0 1000 ${height}">
<defs><radialGradient id="heat"><stop stop-color="${intensityColor(map.map.intensity)}" stop-opacity=".85"/><stop offset="1" stop-color="${intensityColor(map.map.intensity)}" stop-opacity="0"/></radialGradient></defs>
<rect width="1000" height="${height}" fill="#f5f6ef"/><g font-family="Arial,sans-serif" fill="#23382e">
<text x="55" y="75" font-size="30" font-weight="700">iHurt<tspan fill="#768870">.app</tspan></text><text x="55" y="125" font-size="14">${escape(t("export.svg.heading"))} · ${escape(formatDate(map.created))}</text>
${textLines(wrap(map.map.title, 65), 55, 180, 24, 31)}
<defs><g id="body" fill="#c0c9bc" stroke="#f5f6ef" stroke-width="3"><ellipse cx="210" cy="261" rx="23" ry="30"/><path d="M198 286L194 303L162 310L145 370L121 440L130 470L142 450L154 391L173 349L180 430L176 484L180 540L180 613L169 634L195 634L204 538L210 474L216 538L226 634L250 634L239 613L240 540L243 484L240 430L247 349L266 391L278 450L290 470L299 440L275 370L258 310L226 303L222 286Z"/></g></defs>
<use href="#body" transform="translate(-15 165) scale(.639)"/><use href="#body" transform="translate(149 165) scale(.639)"/>
${circles}${points}<text x="99" y="604" font-size="11">${escape(t("export.svg.front"))}</text><text x="265" y="604" font-size="11">${escape(t("export.svg.back"))}</text><text x="55" y="638" font-size="11">${escape(t("export.svg.projection"))}</text>${pinLabels}
<text x="380" y="252" font-size="13" fill="#60715c">${escape(t("export.svg.regions"))}</text>${textLines(regionLines, 380, 281)}
<text x="380" y="${summaryTop - 28}" font-size="13" fill="#60715c">${escape(t("export.svg.description"))}</text>${textLines(summaryLines, 380, summaryTop)}
<text x="380" y="${factsTop - 26}" font-size="13" fill="#60715c">${escape(t("export.svg.context"))}</text>${textLines(facts, 380, factsTop, 14, 25)}
<text x="55" y="${referenceTop}" font-size="13" fill="#60715c">${escape(references ? t("export.svg.reading") : t("export.svg.noReading"))}</text>${references}
<text x="55" y="${height - 128}" font-size="12">${escape(t("export.svg.journal"))}</text><path d="M55 ${height - 104}H945" stroke="#c7cec1"/>
<text x="55" y="${height - 76}" font-size="13" font-weight="700">${escape(t("export.svg.notAdvice"))}</text>
<text x="55" y="${height - 53}" font-size="12">${escape(t("export.svg.colors"))}</text>
<text x="55" y="${height - 30}" font-size="12">${escape(map.map.urgent ? t("export.urgent") : t("export.svg.personal"))}</text></g></svg>`;
}
export function stringifyIhm(map: SavedMap) {
  return JSON.stringify(
    {
      ...exportNotebook([map]),
      bundle: { kind: "ihurt.map", version: 1 },
      review_request: aiPrompt(),
      materials: [
        {
          name: "hurt-map.svg",
          media_type: "image/svg+xml",
          purpose:
            "Derived heatmap preview. The highlights contain the original anatomy coordinates.",
          content: renderMapSvg(map),
        },
      ],
    },
    null,
    2,
  );
}
export function download(map: SavedMap, format: "svg" | "json" | "ihm") {
  const content = format === "svg" ? renderMapSvg(map) : stringifyIhm(map);
  return saveExport({
    name: `ihurt-map-${map.created.slice(0, 10)}.${format}`,
    content,
    mimeType: format === "svg" ? "image/svg+xml" : "application/json",
  });
}
export function downloadNotebook(entries: SavedMap[]) {
  return saveExport({
    name: `ihurt-notebook-${new Date().toISOString().slice(0, 10)}.json`,
    content: stringifyNotebook(entries),
    mimeType: "application/json",
  });
}
export function downloadViewport(view: ViewportCapture, created: string) {
  if (!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(view.image))
    throw new Error(t("export.noImage"));
  return saveExport({
    name: `ihurt-view-${created.slice(0, 10)}.png`,
    content: view.image.slice("data:image/png;base64,".length),
    mimeType: "image/png",
    base64: true,
  });
}
function printProse(text: string) {
  const inline = (value: string) =>
    escape(value)
      .replace(
        /\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g,
        (match, title: string, href: string) => {
          try {
            const url = new URL(href.replaceAll("&amp;", "&"));
            if (url.protocol !== "https:" || url.username || url.password)
              return match;
            return `<a href="${href}">${title}</a>`;
          } catch {
            return match;
          }
        },
      )
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  return text
    .split(/\n\s*\n/)
    .map((block) => {
      if (/^#{1,3} /.test(block))
        return `<h3>${inline(block.replace(/^#{1,3} /, ""))}</h3>`;
      const lines = block.split("\n");
      if (lines.every((line) => /^[-*] /.test(line)))
        return `<ul>${lines.map((line) => `<li>${inline(line.slice(2))}</li>`).join("")}</ul>`;
      if (lines.every((line) => /^\d+\. /.test(line)))
        return `<ol>${lines.map((line) => `<li>${inline(line.replace(/^\d+\. /, ""))}</li>`).join("")}</ol>`;
      return `<p>${lines.map(inline).join("<br/>")}</p>`;
    })
    .join("");
}
export function renderPrintHtml(
  entry: SavedMap,
  view?: ViewportCapture,
): string {
  const validImage =
    view &&
    view.image.length < 8_000_000 &&
    /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(view.image);
  const figure = validImage
    ? `<figure><img src="${view.image}" alt="${escape(t("export.html.figureAlt"))}"/><figcaption>${escape(view.caption)}<br/>${escape(view.visiblePins.length ? t("export.html.visiblePins", { pins: view.visiblePins.join(", ") }) : t("export.html.noVisiblePins"))} ${escape(t("export.html.allNotes"))}</figcaption></figure>`
    : `<p class="context">${escape(t("export.html.noCapture"))}</p>`;
  const facts = [
    [
      t("export.html.activity"),
      entry.map.activity || t("export.html.notRecorded"),
    ],
    [t("export.html.feeling"), entry.map.quality || t("export.html.seeNote")],
    [
      t("export.html.duration"),
      entry.map.duration || t("export.html.notRecorded"),
    ],
    [
      t("export.html.intensity"),
      entry.map.intensity === null
        ? t("export.html.notRated")
        : `${entry.map.intensity} / 10`,
    ],
  ];
  const videos = (entry.references ?? []).filter((r) => r.kind === "video");
  const articles = (entry.references ?? []).filter((r) => r.kind !== "video");
  const referenceList = (items: NonNullable<SavedMap["references"]>) =>
    items
      .map(
        (r) =>
          `<article class="reference"><a href="${escape(r.url)}"><strong>${escape(r.title)}</strong></a><small>${escape(r.publisher)} · ${escape(t("export.html.checked", { date: r.checked }))}</small>${r.context_url ? `<a class="publisher-context" href="${escape(r.context_url)}">${escape(t("export.html.publisherContext"))}</a>` : ""}<span class="reference-url">${escape(r.url)}</span></article>`,
      )
      .join("");
  const pinNotes = (entry.points ?? [])
    .map((p, i) => {
      const side =
        p.position[0] > 0.06
          ? t("export.html.modelLeft")
          : p.position[0] < -0.06
            ? t("export.html.modelRight")
            : t("export.html.midline");
      return `<article class="pin"><b>${i + 1}</b><div><h3>${escape(regionName(p.region))}</h3><small>${escape(side)} · ${escape(p.area ? t("export.html.area") : t("export.html.surfacePin"))}</small><p>${escape(p.comment || t("export.html.noComment"))}</p><div class="structure">${escape(t("export.html.referenceSurface", { structure: p.structure }))}</div></div></article>`;
    })
    .join("");
  return `<!doctype html><html lang="${escape(language())}"><head><meta charset="utf-8"><title>iHurt - ${escape(entry.map.title)}</title><style>
  *{box-sizing:border-box}body{margin:0;color:#25352b;font:11pt/1.55 Arial,sans-serif;background:white}main{max-width:780px;margin:auto;padding:30px}.medical-notice{font-size:10pt;line-height:1.5;border:1px solid #bdcdb3;border-left:4px solid #5a763f;padding:12px 15px;background:#f2f6ed;margin-bottom:22px}.medical-notice strong{display:block;color:#294322}header{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #9eae94;padding-bottom:14px;margin-bottom:22px}.brand{font-size:26pt;font-weight:bold}.record-date{font-size:9pt;text-align:right;color:#5c6d59}small{display:block;font-size:9pt;color:#5b6c57}h1{font-size:25pt;line-height:1.2;margin:14px 0 8px}h2{font-size:15pt;color:#30492b;margin:26px 0 12px}h3{font-size:11pt;margin:0}p{white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0 14px}.subtitle{color:#5b6c57;font-size:10pt;margin-bottom:22px}.facts{display:grid;grid-template-columns:1fr 1fr;border:1px solid #d7dfd0;border-radius:10px;margin:20px 0;overflow:hidden}.fact{padding:10px 14px;border-bottom:1px solid #e1e8da}.fact strong{display:block;font-size:8pt;color:#596d4f;text-transform:uppercase;letter-spacing:.08em}.fact span{display:block;overflow-wrap:anywhere;font-size:11pt}figure{margin:20px 0;padding:12px;background:#f5f6ef;border-radius:12px;width:100%;break-inside:avoid}figure img{width:100%;max-height:345px;object-fit:contain;display:block;border-radius:8px}figcaption{font-size:8pt;text-align:center;color:#64745b;margin-top:8px}.context,.structure{color:#5b6c57;font-size:9pt}.pin{break-inside:avoid;display:flex;gap:14px;padding:15px 0;border-top:1px solid #dfe5d9}.pin b{display:grid;place-items:center;border-radius:50%;width:28px;height:28px;flex-shrink:0;background:#d9eac7;color:#334d26}.pin p{margin:9px 0}.reference{break-inside:avoid;margin:14px 0;padding-left:12px;border-left:3px solid #d6e4c8}.reference small{margin:4px 0}.reference-url{display:block;font-size:8pt;color:#63765a;overflow-wrap:anywhere}.publisher-context{display:block;font-size:9pt}a{color:#365b25;overflow-wrap:anywhere}.notice{font-size:8pt;border-top:1px solid #ccd7c3;margin-top:28px;padding-top:12px;color:#5b6c57}h1,h2,h3{break-after:avoid}li{margin:7px 0;overflow-wrap:anywhere}ul,ol{padding-left:22px}.search-context{padding:12px 15px;background:#f3f6ef;border-radius:8px;font-size:9pt;white-space:pre-wrap;overflow-wrap:anywhere}.notes-section{margin-top:22px}@page{size:A4;margin:18mm 16mm}@media print{main{padding:0}body{font-size:10pt;-webkit-print-color-adjust:exact;print-color-adjust:exact}.medical-notice{font-size:8.5pt;padding:8px 11px;margin-bottom:14px}header{padding-bottom:10px;margin-bottom:14px}.brand{font-size:23pt}.record-date{font-size:8pt}h1{font-size:21pt;margin-top:10px}.subtitle{margin-bottom:14px}.facts{margin:14px 0}.fact{padding:7px 11px}.fact span{font-size:10pt}h2{font-size:14pt;margin:18px 0 10px}p{margin:7px 0 10px}figure{margin:14px 0;padding:9px}figure img{max-height:250px}.notes-section{margin-top:14px}.reference{margin:11px 0}.notice{margin-top:18px}button{display:none}}
  </style></head><body><main>
  <aside class="medical-notice"><strong>${escape(t("export.html.noticeTitle"))}</strong>${escape(t("export.html.noticeBody"))}</aside>
  <header><span class="brand">iHurt.</span><span class="record-date">${escape(t("export.html.journalHeading"))}<br/>${escape(t("export.html.recorded", { date: formatDate(entry.created) }))}${entry.updated ? `<br/>${escape(t("export.html.updated", { date: formatDate(entry.updated) }))}` : ""}</span></header>
  <h1>${escape(entry.map.title || t("export.html.myMap"))}</h1><p class="subtitle">${escape(entry.map.regions.map(regionName).join(" · ") || t("export.html.noRegion"))} · ${escape(t("export.html.marked", { count: (entry.points ?? []).length }))}</p>
  <div class="facts">${facts.map(([label, value]) => `<div class="fact"><strong>${escape(label)}</strong><span>${escape(value)}</span></div>`).join("")}</div>
  <section class="notes-section"><h2>${escape(t("export.html.inYourWords"))}</h2><p>${escape(entry.note || t("export.html.noNote"))}</p></section>${figure}
  <p class="context">${escape(t("export.html.reference"))}</p>
  <section><h2>${escape(t("export.html.byLocation"))}</h2>${pinNotes || `<p>${escape(t("export.html.noPins"))}</p>`}</section>
  ${entry.ai ? `<section><h2>${escape(t("export.html.aiTitle"))}</h2><small>${escape(entry.ai.provider)} · ${escape(t("export.html.aiEarlier"))}</small>${printProse(entry.ai.map.summary)}</section>` : ""}
  ${entry.research ? `<section><h2>${escape(t("export.html.searchTitle"))}</h2><small>${escape(t("export.html.grokSelection"))} · ${escape(formatDate(entry.research.checked))} · ${escape(entry.research.activity)} · ${escape(entry.research.regions.map(regionName).join(", "))}</small><p class="search-context">${escape(entry.research.description || t("export.html.regionOnly"))}</p><small>${escape(t("export.html.searchSent"))}</small></section>` : ""}
  ${videos.length ? `<section><h2>${escape(t("export.html.videosTitle"))}</h2><p class="context">${escape(t("export.html.videosBody"))}</p>${referenceList(videos)}</section>` : ""}
  <section><h2>${escape(t("export.html.readingTitle"))}</h2>${referenceList(articles) || `<p>${escape(t("export.html.noReading"))}</p>`}</section>
  <p class="notice">${escape(t("export.html.privacy"))}<br/>${escape(t("export.html.anatomy"))} <a href="https://github.com/sandbornm/ihurt/blob/main/public/models/ATTRIBUTION.md">${escape(t("export.html.credits"))}</a>.<br/>${escape(t("export.html.madeBy"))} <a href="https://x.com/msxndborn">@msxndborn</a>.</p>
  </main></body></html>`;
}
export function printMap(entry: SavedMap, view?: ViewportCapture): boolean {
  const popup = window.open("", "_blank");
  if (!popup) return false;
  popup.opener = null;
  popup.addEventListener(
    "load",
    () => {
      void Promise.all(
        [...popup.document.images].map((image) =>
          image.decode().catch(() => {}),
        ),
      ).then(() => {
        if (!popup.closed) popup.print();
      });
    },
    { once: true },
  );
  popup.document.write(renderPrintHtml(entry, view));
  popup.document.close();
  return true;
}

export function downloadReport(entry: SavedMap, view?: ViewportCapture) {
  // Reports are self-contained. Opening a saved report cannot load remote code.
  const content = renderPrintHtml(entry, view).replace(
    '<meta charset="utf-8">',
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'">',
  );
  return saveExport({
    name: `ihurt-report-${entry.created.slice(0, 10)}.html`,
    content,
    mimeType: "text/html",
  });
}
