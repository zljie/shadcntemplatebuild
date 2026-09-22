export type Resource = {id:string;name:string;description:string;type:"Skill"|"MCP"|"Document";status:"已发布"|"草稿";version:string;updated:string;author:string};
export const resources:Resource[]=[
{id:"res-01",name:"品牌文案助手",description:"基于品牌语调撰写、润色和本地化内容。",type:"Skill",status:"已发布",version:"1.4.0",updated:"2026-09-20",author:"Design Team"},
{id:"res-02",name:"产品知识库",description:"产品指南、常见问题与团队共享知识。",type:"Document",status:"已发布",version:"2.1.0",updated:"2026-09-19",author:"Product Team"},
{id:"res-03",name:"GitHub Connector",description:"连接代码仓库、Issue 和 Pull Request。",type:"MCP",status:"已发布",version:"1.2.0",updated:"2026-09-18",author:"Engineering"},
{id:"res-04",name:"用户研究分析",description:"整理访谈记录，提炼主题与行动建议。",type:"Skill",status:"已发布",version:"1.0.2",updated:"2026-09-18",author:"Research Team"},
{id:"res-05",name:"设计系统指南",description:"组件使用规则、设计原则与交付约定。",type:"Document",status:"已发布",version:"3.0.0",updated:"2026-09-17",author:"Design Team"},
{id:"res-06",name:"Linear Connector",description:"读取项目计划、工作事项和交付状态。",type:"MCP",status:"已发布",version:"1.1.0",updated:"2026-09-16",author:"Engineering"},
{id:"res-07",name:"会议纪要",description:"将会议记录整理为决策、待办和负责人。",type:"Skill",status:"草稿",version:"0.2.0",updated:"2026-09-15",author:"Operations"},
{id:"res-08",name:"数据探索助手",description:"分析表格数据，识别趋势和异常。",type:"Skill",status:"已发布",version:"1.0.0",updated:"2026-09-14",author:"Data Team"},
];
