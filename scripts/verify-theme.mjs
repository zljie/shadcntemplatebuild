import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { unzipSync, strFromU8 } from 'fflate';

const project=process.env.EXPORTED_PROJECT??'exports/iteration01-resource-page';
const document=JSON.parse(await readFile(`${project}/page.dsl.json`,'utf8'));
const output='test-results/iteration-01';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:2200,height:1800},reducedMotion:'reduce'});
const studio=await context.newPage(),exported=await context.newPage();
const errors=[],results=[];
for(const page of [studio,exported])page.on('pageerror',error=>errors.push(error.message));
const styleProperties=['color','backgroundColor','borderColor','borderRadius','fontFamily','fontSize','fontWeight','lineHeight','padding','gap','display','flexDirection'];
async function snapshot(page){return page.locator('.page-surface').evaluate((root,properties)=>[root,...root.querySelectorAll('*')].map(element=>{const style=getComputedStyle(element),rect=element.getBoundingClientRect(),base=root.getBoundingClientRect();return {geometry:(element instanceof HTMLElement||element.tagName==="svg")&&(rect.width||rect.height)?[rect.x-base.x,rect.y-base.y,rect.width,rect.height].map(value=>Math.round(value*100)/100):null,tag:element.tagName,class:element.getAttribute('class'),text:element.children.length?null:element.textContent,style:Object.fromEntries(properties.map(key=>[key,style[key]]))};}),styleProperties);}
async function compare(state){
  await Promise.all([studio.evaluate(()=>document.fonts.ready),exported.evaluate(()=>document.fonts.ready)]);
  const a=await snapshot(studio),b=await snapshot(exported);
  await writeFile(`${output}/${state}-styles.json`,JSON.stringify({studio:a,exported:b},null,2));
  const difference=a.findIndex((item,index)=>JSON.stringify(item)!==JSON.stringify(b[index]));
  assert(difference===-1&&a.length===b.length,`${state}: style mismatch at ${difference}; see ${output}/${state}-styles.json`);
  const first=await studio.locator('.page-surface').screenshot({path:`${output}/${state}-studio.png`,animations:'disabled',style:'.device-frame{border-radius:0!important;box-shadow:none!important;overflow:visible!important}'});
  const second=await exported.locator('.page-surface').screenshot({path:`${output}/${state}-exported.png`,animations:'disabled',style:'.device-frame{border-radius:0!important;box-shadow:none!important;overflow:visible!important}'});
  results.push({state,stylesAndGeometryMatch:true,screenshotBytesMatch:first.equals(second)});
  await writeFile(`${output}/results.json`,JSON.stringify(results,null,2));
}
async function both(action){for(const page of [studio,exported])await action(page);}
try{
  await studio.goto(process.env.COMPOSER_URL??'http://127.0.0.1:3100');
  await studio.getByRole('button',{name:'保存',exact:true}).waitFor();
  const response=await studio.request.post(new URL('/api/export',studio.url()).href,{data:{document}});
  assert(response.ok(),'ZIP export endpoint must succeed');
  const zip=unzipSync(await response.body());
  for(const [file,content] of Object.entries(zip)){
    const input=await readFile(`${project}/${file}`,'utf8');
    // next build appends generated route references to next-env.d.ts.
    if(file==='next-env.d.ts')assert(input.startsWith(strFromU8(content).trimEnd()),'Generated Next declarations must retain exported references');
    else assert.equal(strFromU8(content),input,`ZIP artifact must equal the independently built input: ${file}`);
  }
  await studio.getByLabel('导入 Page DSL 文件').setInputFiles({name:'page.dsl.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(document))});
  await studio.getByRole('button',{name:'确认导入',exact:true}).click();
  await studio.getByRole('button',{name:'预览',exact:true}).click();
  await studio.getByRole('combobox',{name:'画布缩放',exact:true}).selectOption('1');
  await exported.setViewportSize({width:1440,height:1000});
  await exported.goto(process.env.EXPORT_URL??'http://127.0.0.1:3101');
  await exported.getByRole('textbox',{name:'搜索资源',exact:true}).waitFor();
  await compare('default');
  await both(page=>page.getByRole('textbox',{name:'搜索资源',exact:true}).fill('GitHub'));
  for(const page of [studio,exported])assert.equal(await page.locator('tbody tr').count(),1);
  await compare('search');
  await both(page=>page.getByRole('combobox',{name:'资源类型',exact:true}).selectOption('Document'));
  for(const page of [studio,exported]){assert.equal(await page.locator('tbody tr').count(),0);await page.getByText('没有找到匹配资源',{exact:true}).waitFor();}
  await compare('empty');
  await both(page=>page.getByRole('button',{name:'清除搜索',exact:true}).click());
  for(const page of [studio,exported])assert.equal(await page.locator('tbody tr').count(),2);
  await compare('filter');
  await both(page=>page.getByRole('combobox',{name:'资源类型',exact:true}).selectOption('all'));
  await both(page=>page.getByRole('button',{name:'GitHub Connector',exact:true}).click());
  for(const page of [studio,exported])assert.equal(await page.locator('tbody tr[data-selected="true"]').count(),1);
  await compare('details');
  await both(page=>page.getByRole('button',{name:'关闭详情',exact:true}).click());
  for(const page of [studio,exported])assert.equal(await page.locator('tbody tr[data-selected="true"]').count(),0);
  await both(page=>page.getByRole('button',{name:'了解更多',exact:true}).click());
  for(const page of [studio,exported])await page.getByText('这是可配置的示例操作。',{exact:true}).waitFor();
  await compare('notice');
  // Preview scope must own its theme even when the editor's root values change.
  await studio.evaluate(()=>{document.documentElement.style.setProperty('--primary','#ff00ff');document.documentElement.style.setProperty('--background','#000000');});
  await compare('editor-isolation');
  assert.deepEqual(errors,[]);
  console.log('PASS: independent runtime interactions; matching 1440px preview/export styles and geometry in seven states; screenshots saved for visual inspection; editor token isolation');
}catch(error){await studio.screenshot({path:`${output}/failure-studio.png`,fullPage:true});await exported.screenshot({path:`${output}/failure-exported.png`,fullPage:true});throw error;}finally{await browser.close();}
