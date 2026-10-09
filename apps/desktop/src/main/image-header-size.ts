import { open } from "node:fs/promises";

/** Bounded header probe (PNG, GIF, WebP, JPEG) that reads pixel dimensions without decoding the image. */
export function imageHeaderSize(bytes: Buffer): {width:number;height:number} | null {
  let width=0,height=0;
  if(bytes.length>=24&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){width=bytes.readUInt32BE(16);height=bytes.readUInt32BE(20);}
  else if(bytes.length>=10&&/^GIF8[79]a/.test(bytes.toString("ascii",0,6))){width=bytes.readUInt16LE(6);height=bytes.readUInt16LE(8);}
  else if(bytes.length>=30&&bytes.toString("ascii",0,4)==="RIFF"&&bytes.toString("ascii",8,12)==="WEBP"){
    const kind=bytes.toString("ascii",12,16);
    if(kind==="VP8X"){width=1+bytes.readUIntLE(24,3);height=1+bytes.readUIntLE(27,3);}
    else if(kind==="VP8L"&&bytes[20]===0x2f){const dimensions=bytes.readUInt32LE(21);width=1+(dimensions&0x3fff);height=1+((dimensions>>>14)&0x3fff);}
    else if(kind==="VP8 "&&bytes.toString("hex",23,26)==="9d012a"){width=bytes.readUInt16LE(26)&0x3fff;height=bytes.readUInt16LE(28)&0x3fff;}
  }else if(bytes[0]===0xff&&bytes[1]===0xd8){
    let offset=2;
    while(offset+4<bytes.length){
      if(bytes[offset++]!==0xff)break;
      while(bytes[offset]===0xff)offset++;
      const marker=bytes[offset++]!;
      if(marker===0xd9||marker===0xda)break;
      if(marker===0x01||marker>=0xd0&&marker<=0xd7)continue;
      if(offset+2>bytes.length)break;
      const length=bytes.readUInt16BE(offset);if(length<2||offset+length>bytes.length)break;
      if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)&&length>=8){height=bytes.readUInt16BE(offset+3);width=bytes.readUInt16BE(offset+5);break;}
      offset+=length;
    }
  }
  return width>0&&height>0?{width,height}:null;
}
export async function readImageHeaderSize(path:string, maxBytes=1024*1024) {
  const file=await open(path,"r");
  try{const bytes=Buffer.alloc(maxBytes);const {bytesRead}=await file.read(bytes,0,bytes.length,0);return imageHeaderSize(bytes.subarray(0,bytesRead));}
  finally{await file.close();}
}
