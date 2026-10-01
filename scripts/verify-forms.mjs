import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

const project=process.env.EXPORTED_PROJECT;
assert(project,'Set EXPORTED_PROJECT to a fresh independently built MCP export');
const document=JSON.parse(await readFile(`${project}/page.dsl.json`,'utf8')),config=document.listDetail;
assert(config.form,'DSL must enable form actions');
const output=process.env.VERIFY_OUTPUT??`test-results/business-forms/${document.id}`;
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:2200,height:1400},reducedMotion:'reduce'});
const studio=await context.newPage(),exported=await context.newPage(),errors=[],results=[];
for(const page of [studio,exported]){page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(15000);}
const fields=config.form.fields.map(key=>config.fields.find(field=>field.key===key));
const dialog=page=>page.locator('.runtime-form-dialog');
const input=(page,field)=>dialog(page).locator(`[name="${field.key}"]`);
const button=(page,name)=>page.getByRole('button',{name,exact:true});
async function fill(page,values){for(const field of fields){if(field.options)await input(page,field).selectOption(String(values[field.key]));else await input(page,field).fill(String(values[field.key]));}}
async function open(page,edit=false){await button(page,`${edit?'编辑':'新增'}${config.entityName}`).click();await dialog(page).waitFor();}
async function close(page,name='取消'){await dialog(page).getByRole('button',{name,exact:true}).click();await dialog(page).waitFor({state:'hidden'});}
async function formSnapshot(page){return dialog(page).evaluate(root=>[root,...root.querySelectorAll('input,select,label,button,p')].map(element=>{const s=getComputedStyle(element);return {tag:element.tagName,text:element.tagName==='SELECT'?null:element.textContent,value:element.value,style:Object.fromEntries(['fontFamily','fontSize','color','backgroundColor','borderColor','borderRadius','padding','gap'].map(key=>[key,s[key]]))};}));}
try{
  await studio.goto(process.env.COMPOSER_URL??'http://127.0.0.1:3100');await button(studio,'保存').waitFor();
  await studio.getByLabel('导入 Page DSL 文件').setInputFiles({name:'form.dsl.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(document))});await button(studio,'确认导入').click();await button(studio,'预览').click();await studio.getByRole('combobox',{name:'画布缩放',exact:true}).selectOption('1');
  await exported.setViewportSize({width:1440,height:1000});await exported.goto(process.env.EXPORT_URL??'http://127.0.0.1:3101');
  for(const page of [studio,exported]){
    await button(page,`新增${config.entityName}`).waitFor();assert.equal(await page.locator('tbody tr').count(),config.rows.length);
    await open(page);for(const field of fields)assert.equal(await input(page,field).inputValue(),String(field.default));
    await expect(input(page,fields[0])).toBeFocused();
    await input(page,fields[0]).fill('取消的输入');await close(page);assert.equal(await page.locator('tbody tr').count(),config.rows.length);await expect(button(page,`新增${config.entityName}`)).toBeFocused();
    await button(page,`新增${config.entityName}`).focus();await page.keyboard.press('Enter');await dialog(page).waitFor();await page.keyboard.press('Tab');assert(await dialog(page).evaluate(element=>element.contains(document.activeElement)));await page.keyboard.press('Escape');await dialog(page).waitFor({state:'hidden'});
    await open(page);await dialog(page).getByRole('button',{name:'保存记录',exact:true}).click();assert.equal(await input(page,fields[0]).getAttribute('aria-invalid'),'true');await expect(input(page,fields[0])).toBeFocused();assert(await dialog(page).getByRole('alert').count()>0);
    const described=await input(page,fields[0]).getAttribute('aria-describedby');assert(described&&await page.locator(`[id="${described}"]`).count()===1);
    await close(page,'关闭表单');
  }
  await open(studio);await open(exported);assert.deepEqual(await formSnapshot(studio),await formSnapshot(exported));await dialog(studio).screenshot({path:`${output}/create-studio.png`});await dialog(exported).screenshot({path:`${output}/create-exported.png`});
  await close(studio);await close(exported);
  const first=config.rows[0],values=Object.fromEntries(fields.map(field=>[field.key,first[field.key]]));
  values[config.titleField]=`验收${config.entityName}`;values[config.form.uniqueField]=config.form.uniqueField===config.titleField?values[config.titleField]:'acceptance.user';
  for(const page of [studio,exported]){
    await open(page);await fill(page,values);
    const number=fields.find(field=>field.type==='number');
    if(number){for(const value of [String(number.min-1),'1.5']){await input(page,number).fill(value);await dialog(page).getByRole('button',{name:'保存记录',exact:true}).click();assert.equal(await input(page,number).getAttribute('aria-invalid'),'true');}await input(page,number).fill(String(values[number.key]));}
    const enumeration=fields.find(field=>field.options);
    await input(page,enumeration).evaluate(element=>{const option=document.createElement('option');option.value='invalid-enum';option.text='invalid';element.append(option);});await input(page,enumeration).selectOption('invalid-enum');await dialog(page).getByRole('button',{name:'保存记录',exact:true}).click();assert.equal(await input(page,enumeration).getAttribute('aria-invalid'),'true');await input(page,enumeration).selectOption(String(values[enumeration.key]));
    // Natural duplicate identity yields deterministic adapter failure without a product test switch.
    await input(page,fields.find(field=>field.key===config.form.uniqueField)).fill(String(first[config.form.uniqueField]));await dialog(page).getByRole('button',{name:'保存记录',exact:true}).click();await dialog(page).getByText('模拟提交失败：已有相同记录，请修改后重试。',{exact:true}).waitFor();for(const field of fields)assert.equal(await input(page,field).inputValue(),String(field.key===config.form.uniqueField?first[field.key]:values[field.key]));assert.equal(await page.locator('tbody tr').count(),config.rows.length);
    await fill(page,values);
    // Dispatch twice in one event turn to exercise the synchronous submission lock.
    await dialog(page).locator('form').evaluate(form=>{form.requestSubmit();form.requestSubmit();});
    await dialog(page).getByRole('button',{name:'提交中…',exact:true}).waitFor();assert(await dialog(page).getByRole('button',{name:'取消',exact:true}).isDisabled());assert(await dialog(page).getByRole('button',{name:'关闭表单',exact:true}).isDisabled());await page.keyboard.press('Escape');assert(await dialog(page).isVisible());await dialog(page).waitFor({state:'hidden'});
    assert.equal(await page.locator('tbody tr').count(),config.rows.length+1);assert.equal(await button(page,String(values[config.titleField])).count(),1);await page.getByText(new RegExp('模拟新增成功')).waitFor();
    const search=page.getByRole('textbox',{name:`搜索${config.entityName}`,exact:true});await search.fill(String(values[config.titleField]));assert.equal(await page.locator('tbody tr').count(),1);await search.fill('');
    for(const key of config.filters){await page.getByRole('combobox',{name:config.fields.find(field=>field.key===key).label,exact:true}).selectOption(`value:${values[key]??config.fields.find(field=>field.key===key).default}`);assert(await button(page,String(values[config.titleField])).isVisible());await page.getByRole('combobox',{name:config.fields.find(field=>field.key===key).label,exact:true}).selectOption('all');}
    await open(page,true);for(const field of fields)assert.equal(await input(page,field).inputValue(),String(values[field.key]));await input(page,fields[0]).fill('取消编辑');await close(page);assert(await button(page,String(values[config.titleField])).isVisible());
    await open(page,true);const updated={...values,[config.titleField]:`更新${config.entityName}`};if(number)updated[number.key]=7;
    const boolean=fields.find(field=>field.type==='boolean');if(boolean)updated[boolean.key]=false;
    await fill(page,updated);await dialog(page).getByRole('button',{name:'保存记录',exact:true}).click();await dialog(page).waitFor({state:'hidden'});
    assert.equal(await page.locator('tbody tr').count(),config.rows.length+1);assert(await button(page,String(updated[config.titleField])).isVisible());assert.equal(await page.locator('.context-panel h2').textContent(),String(updated[config.titleField]));
    for(const field of fields){const i=config.detailFields.indexOf(field.key),value=typeof updated[field.key]==='boolean'?(updated[field.key]?field.trueLabel??'是':field.falseLabel??'否'):String(updated[field.key]);assert.equal(await page.locator('.context-panel dd').nth(i).textContent(),value);}
    await page.locator('.page-surface').screenshot({path:`${output}/${page===studio?'studio':'exported'}-updated.png`});
    results.push({surface:page===studio?'editor':'independent',defaultFocusCancelKeyboardErrors:true,numericEnumErrors:true,duplicateFailureRetainsInput:true,doubleSubmitSingleRecord:true,createSearchFilters:true,editPrefillCancelListDetailsSync:true});
  }
  const downloaded=studio.waitForEvent('download');await button(studio,'导出 DSL').first().click();assert.deepEqual(JSON.parse(await readFile(await (await downloaded).path(),'utf8')),document,'Record mutations must never modify structural DSL');
  // Real narrow viewport: edit through the existing details Dialog, then focus returns to its edit entry.
  await exported.setViewportSize({width:390,height:900});await exported.reload();await button(exported,String(first[config.titleField])).click();await exported.getByRole('dialog').waitFor();await open(exported,true);await dialog(exported).screenshot({path:`${output}/mobile-form.png`});assert.equal(await dialog(exported).getByRole('textbox').first().inputValue(),String(first[fields[0].key]));await close(exported);await pageEscape(exported);assert.equal(await exported.locator('tbody tr').count(),config.rows.length,'Reload restores original fixtures');
  await studio.reload();await button(studio,'保存').waitFor();await studio.getByLabel('导入 Page DSL 文件').setInputFiles({name:'again.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(document))});await button(studio,'确认导入').click();await button(studio,'预览').click();assert.equal(await studio.locator('tbody tr').count(),config.rows.length);
  assert.deepEqual(errors,[]);results.push({dslUnchanged:true,mobileNestedDialogKeyboard:true,refreshResetsFixtures:true,dialogStylesMatch:true});await writeFile(`${output}/form-results.json`,JSON.stringify(results,null,2));console.log(`PASS ${document.name}: shared forms in editor and independent app`);
}catch(error){await studio.screenshot({path:`${output}/form-failure-studio.png`,fullPage:true});await exported.screenshot({path:`${output}/form-failure-exported.png`,fullPage:true});throw error;}finally{await browser.close();}
async function pageEscape(page){await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});}
