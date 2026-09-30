import type { CSSProperties } from "react";
import { tokenValues } from "./tokens";
// Only known semantic values resolve to CSS; raw CSS never reaches a style attribute.
const values:Record<string,string>={...tokenValues,"width.full":"100%","width.auto":"auto",row:"row",column:"column",start:"flex-start",center:"center",stretch:"stretch"};
export type Presentation={layout?:Record<string,unknown>;tokens?:Record<string,unknown>;responsive?:{tablet?:Record<string,unknown>;mobile?:Record<string,unknown>}};
export function presentation(config:Presentation){const style:Record<string,string>={};
  for(const [prefix,layout] of [["",config.layout],["t-",config.responsive?.tablet],["m-",config.responsive?.mobile]] as const){
    for(const [key,value] of Object.entries(layout??{})){if(key==="hidden"){style[`--${prefix}node-display`]=value?"none":"flex";}else if(typeof value==="string"&&values[value])style[`--${prefix}node-${key}`]=values[value];}
  }
  for(const [key,value] of Object.entries(config.tokens??{})){if(typeof value==="string"&&values[value])style[`--node-${key}`]=values[value];}
  return {className:"node-layout",style:style as CSSProperties};
}
