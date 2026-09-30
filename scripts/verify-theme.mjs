import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { unzipSync, strFromU8 } from 'fflate';

const project=process.env.EXPORTED_PROJECT??'exports/iteration01-resource-page';
const document=JSON.parse(await readFile(`${project}/page.dsl.json`,'utf8'));
const output=process.env.VERIFY_OUTPUT??(document.listDetail?`test-results/mcp-pages/${document.id}`:'test-results/iteration-01');
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
  if(document.listDetail){
    const config=document.listDetail,first=config.rows[0];
    const textbox=`搜索${config.entityName}`;
    const value=(key,row)=>typeof row[key]==='boolean'?(row[key]?config.fields.find(f=>f.key===key).trueLabel??'是':config.fields.find(f=>f.key===key).falseLabel??'否'):String(row[key]);
    for(const page of [studio,exported]){
      await page.getByRole('textbox',{name:textbox,exact:true}).waitFor();
      assert.equal(await page.locator('tbody tr').count(),config.rows.length);
      for(const [index,row] of config.rows.entries())for(const [columnIndex,column] of config.columns.entries())assert((await page.locator('tbody tr').nth(index).locator('td').nth(columnIndex).innerText()).includes(value(column.field,row)),`Missing cell ${row.id}.${column.field}`);
      for(const column of config.columns)assert(await page.getByRole('columnheader',{name:column.title,exact:true}).isVisible());
      assert(await page.getByText('SIMULATION 示例数据',{exact:true}).first().isVisible());
      assert.equal(await page.locator('.runtime-topbar strong').textContent(),document.name);
    }
    await compare('default');
    const query=String(first[config.titleField]);
    await both(page=>page.getByRole('textbox',{name:textbox,exact:true}).fill(query));
    const expected=config.rows.filter(row=>config.searchFields.map(key=>value(key,row)).join(' ').toLowerCase().includes(query.toLowerCase())).length;
    for(const page of [studio,exported])assert.equal(await page.locator('tbody tr').count(),expected);
    await compare('search');
    if(config.searchFields.length>1){const secondary=String(first[config.searchFields[1]]);await both(page=>page.getByRole('textbox',{name:textbox,exact:true}).fill(secondary));for(const page of [studio,exported])assert.equal(await page.locator('tbody tr').count(),config.rows.filter(row=>config.searchFields.map(key=>value(key,row)).join(' ').toLowerCase().includes(secondary.toLowerCase())).length);}
    await both(page=>page.getByRole('textbox',{name:textbox,exact:true}).fill('__no_matching_example__'));
    for(const page of [studio,exported]){assert.equal(await page.locator('tbody tr').count(),0);await page.getByText(`没有找到匹配${config.entityName}`,{exact:true}).waitFor();}
    await compare('empty');
    await both(page=>page.getByRole('button',{name:'清除搜索',exact:true}).click());
    for(const key of config.filters){const label=config.fields.find(f=>f.key===key).label;const option=config.rows.find(row=>row[key]===false)??first;await both(page=>page.getByRole('combobox',{name:label,exact:true}).selectOption(`value:${option[key]}`));for(const page of [studio,exported])assert.equal(await page.locator('tbody tr').count(),config.rows.filter(row=>row[key]===option[key]).length);await both(page=>page.getByRole('combobox',{name:label,exact:true}).selectOption('all'));}
    for(const key of config.filters){const label=config.fields.find(f=>f.key===key).label;await both(page=>page.getByRole('combobox',{name:label,exact:true}).selectOption(`value:${first[key]}`));}
    const matched=config.rows.filter(row=>config.filters.every(key=>row[key]===first[key]));
    for(const page of [studio,exported])assert.equal(await page.locator('tbody tr').count(),matched.length);
    await compare('filter');
    for(const key of config.filters)await both(page=>page.getByRole('combobox',{name:config.fields.find(f=>f.key===key).label,exact:true}).selectOption('all'));
    await both(page=>page.getByRole('button',{name:String(first[config.titleField]),exact:true}).click());
    for(const page of [studio,exported]){assert.equal(await page.locator('tbody tr[data-selected="true"]').count(),1);for(const key of config.detailFields)assert.equal(await page.locator('.context-panel dl dd').nth(config.detailFields.indexOf(key)).textContent(),value(key,first));}
    await compare('details');
    await both(page=>page.getByRole('button',{name:'关闭详情',exact:true}).click());
    for(const page of [studio,exported])assert.equal(await page.locator('tbody tr[data-selected="true"]').count(),0);
    for(const row of config.rows.filter(row=>Object.values(row).some(value=>value===0||value===false))){await both(page=>page.getByRole('button',{name:String(row[config.titleField]),exact:true}).click());for(const page of [studio,exported])for(const key of config.detailFields)assert.equal(await page.locator('.context-panel dl dd').nth(config.detailFields.indexOf(key)).textContent(),value(key,row));await compare(`edge-${row.id}`);await both(page=>page.getByRole('button',{name:'关闭详情',exact:true}).click());}
    await studio.getByRole('button',{name:'手机',exact:true}).click();
    await exported.setViewportSize({width:390,height:900});
    for(const page of [studio,exported]){await page.getByRole('button',{name:String(first[config.titleField]),exact:true}).click();const dialog=page.getByRole('dialog');await dialog.waitFor();assert(await dialog.getByRole('heading',{name:String(first[config.titleField]),exact:true}).isVisible());await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert.equal(await page.locator('tbody tr[data-selected="true"]').count(),0);}
    results.push({state:'mobile-dialog',openAndEscapeClose:true});
    await studio.getByRole('button',{name:'桌面',exact:true}).click();await exported.setViewportSize({width:1440,height:1000});
    const downloaded=studio.waitForEvent('download');await studio.getByRole('button',{name:'导出 DSL',exact:true}).first().click();assert.deepEqual(JSON.parse(await readFile(await (await downloaded).path(),'utf8')),document);
  }else{
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
  }
  // Preview scope must own its theme even when the editor's root values change.
  await studio.evaluate(()=>{document.documentElement.style.setProperty('--primary','#ff00ff');document.documentElement.style.setProperty('--background','#000000');});
  await compare('editor-isolation');
  assert.deepEqual(errors,[]);
  console.log(`PASS: ${document.name} independent runtime interactions; matching 1440px preview/export styles and geometry; screenshots saved; ${document.listDetail?'business fields, filters, zero/false, DSL round trip and mobile Dialog':'resource regression'}; editor token isolation`);
}catch(error){await studio.screenshot({path:`${output}/failure-studio.png`,fullPage:true});await exported.screenshot({path:`${output}/failure-exported.png`,fullPage:true});throw error;}finally{await browser.close();}
