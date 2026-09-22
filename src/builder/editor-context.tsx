"use client";
import { createContext, useContext } from "react";
import type { PageNode } from "@/core/schema";
import type { Target } from "@/core/validation";
export type DragSource={componentRef?:string;nodeId?:string};
export const EditorContext=createContext<{source:DragSource|null;sourceNode:PageNode|null;target:Target|null;chooseTarget:(target:Target)=>void}>({source:null,sourceNode:null,target:null,chooseTarget:()=>{}});
export const useEditor=()=>useContext(EditorContext);
