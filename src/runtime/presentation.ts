import type { CSSProperties } from "react";
// Only known semantic values resolve to CSS; raw CSS never reaches a style attribute.
const values:Record<string,string>={"space.0":"0px","space.2":"8px","space.3":"12px","space.4":"16px","space.6":"24px","space.8":"32px","width.full":"100%","width.auto":"auto","color.surface":"var(--surface)","color.muted":"var(--surface-muted)","radius.sm":"4px","radius.md":"8px","radius.lg":"12px",row:"row",column:"column",start:"flex-start",center:"center",stretch:"stretch"};
export type Presentation={layout?:Record<string,unknown>;tokens?:Record<string,unknown>;responsive?:{tablet?:Record<string,unknown>;mobile?:Record<string,unknown>}};
export function presentation(config:Presentation){const style:Record<string,string>={};
  for(const [prefix,layout] of [["",config.layout],["t-",config.responsive?.tablet],["m-",config.responsive?.mobile]] as const){
    for(const [key,value] of Object.entries(layout??{})){if(key==="hidden"){style[`--${prefix}node-display`]=value?"none":"flex";}else if(typeof value==="string"&&values[value])style[`--${prefix}node-${key}`]=values[value];}
  }
  for(const [key,value] of Object.entries(config.tokens??{})){if(typeof value==="string"&&values[value])style[`--node-${key}`]=values[value];}
  return {className:"node-layout",style:style as CSSProperties};
}
