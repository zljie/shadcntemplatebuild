import { recordActions, type DataRecord, type ListDetail, type RecordField } from "./data";

export type RecordIssue = {path:string;message:string};
export type RecordResult = {ok:true;record:DataRecord;rows:DataRecord[]} | {ok:false;errors:RecordIssue[];message:string};
export function fieldError(field:RecordField,value:unknown):string | undefined {
  const expected=field.type==="text"?"string":field.type;
  if(typeof value!==expected)return `请输入有效的${field.label}`;
  if(typeof value==="string"){
    if(field.required&&!value.trim())return `${field.label}必填`;
    if(value.length<(field.minLength??0)||value.length>(field.maxLength??1000))return `${field.label}长度应为 ${field.minLength??0}–${field.maxLength??1000} 个字符`;
  }
  if(typeof value==="number"&&(!Number.isFinite(value)||(field.integer&&!Number.isInteger(value))||value<(field.min??-1e9)||value>(field.max??1e9)))return `${field.label}应为 ${field.min??-1e9}–${field.max??1e9} 范围内的${field.integer?"整数":"数字"}`;
  if(field.options&&!field.options.some(option=>option.value===value))return `请选择有效的${field.label}`;
  if(field.format==="date"&&typeof value==="string"&&value&&!/^\d{4}-\d{2}-\d{2}$/.test(value))return `${field.label}应为 YYYY-MM-DD 格式`;
}
export function validateBusinessConfig(config:ListDetail):RecordIssue[]{
  if(!config.form)return config.fields.some(field=>[field.default,field.required,field.minLength,field.maxLength,field.min,field.max,field.integer,field.options].some(value=>value!==undefined))?[{path:"listDetail.form",message:"字段约束需要声明表单配置"}]:[];
  const issues:RecordIssue[]=[];
  const add=(path:string,message:string)=>issues.push({path:`listDetail.${path}`,message});
  const form=config.form,keys=new Set(config.fields.map(f=>f.key));
  if(new Set(form.fields).size!==form.fields.length)add("form.fields","表单字段重复");
  form.fields.forEach((key,i)=>{if(!keys.has(key))add(`form.fields.${i}`,`未声明字段 ${key}`);});
  if(new Set(form.actions).size!==form.actions.length||form.actions.some(action=>!recordActions.includes(action)))add("form.actions","动作必须唯一且已注册");
  const unique=config.fields.find(field=>field.key===form.uniqueField);
  if(!unique||unique.type!=="text"||!unique.required||!form.fields.includes(form.uniqueField))add("form.uniqueField","唯一字段必须是可编辑的必填文本字段");
  config.fields.forEach((field,i)=>{
    const path=`fields.${i}`;
    if(field.type!=="text"&&(field.minLength!==undefined||field.maxLength!==undefined))add(path,"长度限制仅用于文本");
    if(field.type!=="number"&&(field.min!==undefined||field.max!==undefined||field.integer!==undefined))add(path,"数值限制仅用于数字");
    if((field.min??-1e9)>(field.max??1e9)||(field.minLength??0)>(field.maxLength??1000))add(path,"最小值不能大于最大值");
    if(field.options){
      if(new Set(field.options.map(option=>JSON.stringify(option.value))).size!==field.options.length)add(`${path}.options`,"枚举值重复");
      if(field.options.some(option=>typeof option.value!==(field.type==="text"?"string":field.type)||option.value===""))add(`${path}.options`,"枚举类型必须匹配字段类型且不能为空字符串");
      if(field.options.some(option=>fieldError(field,option.value)))add(`${path}.options`,"枚举值必须满足字段约束");
    }
    if(form.fields.includes(field.key)&&field.type==="boolean"&&!field.options)add(path,"可编辑布尔字段需提供单选枚举");
    if(form.actions.includes("record.create")&&field.default===undefined)add(`${path}.default`,"新增时所有字段都需要默认值（必填文本允许空初值）");
    if(field.default!==undefined&&!(field.type==="text"&&field.default===""&&form.fields.includes(field.key))){const error=fieldError(field,field.default);if(error)add(`${path}.default`,error);}
  });
  const seen=new Set<unknown>();
  config.rows.forEach((row,i)=>{
    config.fields.forEach(field=>{const error=fieldError(field,row[field.key]);if(error)add(`rows.${i}.${field.key}`,error);});
    if(seen.has(row[form.uniqueField]))add(`rows.${i}.${form.uniqueField}`,"示例唯一字段重复");seen.add(row[form.uniqueField]);
  });
  return issues;
}

export type RecordRequest={operationId:string;action:string;recordId?:string;values:Record<string,unknown>};
const fail=(errors:RecordIssue[],message="提交失败，请检查输入后重试。"):RecordResult=>({ok:false,errors,message});
/** Validates one create/update request against config.form and applies it to rows. Shared by the session adapter and the SQLite store. */
export function applyRecordRequest(config:ListDetail,rows:DataRecord[],request:unknown,{maxRows=200,newId=()=>crypto.randomUUID()}:{maxRows?:number;newId?:()=>string}={}):RecordResult{
  if(!request||typeof request!=="object"||Array.isArray(request))return fail([{path:"action",message:"非法操作请求"}]);
  const input=request as Record<string,unknown>;
  if(Object.keys(input).some(key=>!["operationId","action","recordId","values"].includes(key)))return fail([{path:"action",message:"未注册请求属性"}]);
  const form=config.form;
  if(!form)return fail([{path:"form",message:"非法表单配置"}]);
  if(!recordActions.some(action=>action===input.action)||!form.actions.some(action=>action===input.action))return fail([{path:"action",message:"未注册或未启用动作"}]);
  const old=input.action==="record.update"?rows.find(row=>row.id===input.recordId):undefined;
  if(input.action==="record.update"&&!old)return fail([{path:"recordId",message:"要编辑的记录不存在"}]);
  if(input.action==="record.create"&&input.recordId!==undefined)return fail([{path:"recordId",message:"新增不能指定记录 ID"}]);
  if(!input.values||typeof input.values!=="object"||Array.isArray(input.values))return fail([{path:"values",message:"非法字段输入"}]);
  const values=input.values as Record<string,unknown>,errors:RecordIssue[]=[];
  Object.keys(values).forEach(key=>{if(!form.fields.includes(key))errors.push({path:`values.${key}`,message:"未注册或只读字段"});});
  form.fields.forEach(key=>{const error=fieldError(config.fields.find(field=>field.key===key)!,values[key]);if(error)errors.push({path:`values.${key}`,message:error});});
  if(errors.length)return fail(errors);
  if(rows.some(row=>row.id!==old?.id&&row[form.uniqueField]===values[form.uniqueField]))return fail([{path:`values.${form.uniqueField}`,message:`${config.fields.find(f=>f.key===form.uniqueField)!.label}已存在`}],"提交失败：已有相同记录，请修改后重试。");
  if(!old&&rows.length>=maxRows)return fail([{path:"rows",message:`记录上限为 ${maxRows} 条`}]);
  const record={...(old??Object.fromEntries(config.fields.map(field=>[field.key,field.default]))),...values,id:old?.id??newId()} as DataRecord;
  config.fields.forEach(field=>{const error=fieldError(field,record[field.key]);if(error)errors.push({path:`values.${field.key}`,message:error});});
  if(errors.length)return fail(errors);
  const next=old?rows.map(row=>row.id===old.id?record:row):[...rows,record];
  return {ok:true,record:structuredClone(record),rows:structuredClone(next)};
}

// ponytail: session-only rows and idempotency ledger, bounded to small demos; the SQLite adapter lives in src/server.
export function createRecordSession(config:ListDetail){
  const snapshot=structuredClone(config);
  let rows=structuredClone(snapshot.rows);
  const operations=new Map<string,{signature:string;result:Promise<RecordResult>}>();
  async function apply(request:unknown):Promise<RecordResult>{
    if(validateBusinessConfig(snapshot).length||!snapshot.form)return fail([{path:"form",message:"非法表单配置"}]);
    const result=applyRecordRequest(snapshot,rows,request);
    if(!result.ok&&result.message==="提交失败：已有相同记录，请修改后重试。")return {...result,message:"模拟提交失败：已有相同记录，请修改后重试。"};
    if(result.ok)rows=result.rows;
    return result;
  }
  return {
    get rows(){return structuredClone(rows);},
    submit(request:unknown):Promise<RecordResult>{
      const input=request as Record<string,unknown>|null;
      if(!input||typeof input.operationId!=="string"||!input.operationId||input.operationId.length>80)return Promise.resolve(fail([{path:"operationId",message:"操作 ID 必须为非空字符串，最多 80 字符"}]));
      const signature=JSON.stringify(request),existing=operations.get(input.operationId),payload=structuredClone(request);
      if(existing)return existing.signature===signature?existing.result:Promise.resolve(fail([{path:"operationId",message:"同一操作 ID 不能更换输入"}]));
      // Model asynchronous submission without introducing a backend or UI test switches.
      const result=new Promise<void>(resolve=>setTimeout(resolve,200)).then(()=>apply(payload));
      operations.set(input.operationId,{signature,result});return result;
    },
  };
}
