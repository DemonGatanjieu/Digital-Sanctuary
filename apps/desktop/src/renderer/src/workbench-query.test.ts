import { describe, expect, it } from "vitest";
import { workbenchQuery } from "./workbench-query";
describe("one organizing request",()=>{
  it("uses exploration rules when the request is empty",()=>{
    expect(workbenchQuery("  ",{})).toEqual({mode:"rules",text:"",include:[],exclude:[]});
  });
  it("combines a Chinese description and explicit element conditions without a mode switch",()=>{
    expect(workbenchQuery(" 海边女孩 ",{blue_hair:"include",blood:"exclude"},"blue_hair，glasses","guro blood"))
      .toEqual({mode:"description",text:"海边女孩",include:["blue_hair","glasses"],exclude:["blood","guro"]});
  });
  it("uses exact elements for a blank description with conditions and returns to rules when cleared",()=>{
    expect(workbenchQuery("",{night:"include"})).toMatchObject({mode:"elements",include:["night"]});
    expect(workbenchQuery("",{},"","blood")).toMatchObject({mode:"elements",exclude:["blood"]});
    expect(workbenchQuery("",{}).mode).toBe("rules");
  });
});
