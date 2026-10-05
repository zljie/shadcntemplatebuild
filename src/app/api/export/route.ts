import { NextResponse } from "next/server";
import { zipSync, strToU8 } from "fflate";
import { exportProject } from "@/core/export-project";
import { validateDocument } from "@/core/validation";
import type { PageDocument } from "@/core/schema";
import { sameOrigin } from "@/core/http";
export const runtime="nodejs";
export async function POST(request:Request){
  try{
    if(!sameOrigin(request))return NextResponse.json({error:"跨站导出请求被拒绝"},{status:403});
    const text=await request.text();if(text.length>2_000_000)return NextResponse.json({error:"文档超过 2 MB 限制"},{status:413});
    const body=JSON.parse(text);const issues=validateDocument(body.document);if(issues.length)return NextResponse.json({error:issues.map(e=>`${e.path}: ${e.message}`).join("；")},{status:400});
    const files=await exportProject(body.document as PageDocument);
    if(body.format==="code")return NextResponse.json({code:files["src/app/page.tsx"],files:Object.keys(files)});
    const zip=zipSync(Object.fromEntries(Object.entries(files).map(([name,content])=>[name,[strToU8(content),{mtime:new Date("2020-01-01T00:00:00Z")}]])),{level:6});
    return new Response(new Uint8Array(zip),{headers:{"Content-Type":"application/zip","Content-Disposition":'attachment; filename="composed-page.zip"'}});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"导出失败"},{status:400});}
}
