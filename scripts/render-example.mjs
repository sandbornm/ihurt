import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import {parseNotebook} from '../src/notebook-data.ts';
import {renderPrintHtml} from '../src/export.ts';
const entry=parseNotebook(await readFile('docs/examples/neck-tennis.json','utf8'))[0];
await mkdir('output/pdf',{recursive:true});
const browser=await chromium.launch({headless:true});
try{const page=await browser.newPage();await page.setContent(renderPrintHtml(entry));await page.pdf({path:'output/pdf/neck-tennis.pdf',printBackground:true,preferCSSPageSize:true,displayHeaderFooter:true,headerTemplate:'<span></span>',footerTemplate:'<div style="font-size:9px;width:100%;text-align:center;color:#75806b">iHurt · Personal journal · <span class="pageNumber"></span> / <span class="totalPages"></span></div>',margin:{bottom:'18mm'}});await writeFile('docs/examples/neck-tennis.pdf',await readFile('output/pdf/neck-tennis.pdf'));}finally{await browser.close();}
