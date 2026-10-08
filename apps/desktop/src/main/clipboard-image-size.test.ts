import { describe, expect, it } from "vitest";
import { clipboardImageSize } from "./clipboard-image-size";
describe("clipboard bitmap preflight",()=>{
  it("reads original PNG dimensions so a small image is never enlarged",()=>{
    const png=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.writeUInt32BE(384,16);png.writeUInt32BE(256,20);
    expect(clipboardImageSize(png)).toEqual({width:384,height:256});png.writeUInt32BE(100000,16);png.writeUInt32BE(512,20);expect(clipboardImageSize(png)!.width*clipboardImageSize(png)!.height).toBeGreaterThan(32_000_000);
  });
  it("finds JPEG dimensions after metadata and rejects truncated headers",()=>{
    const jpeg=Buffer.from([255,216,255,225,0,4,0,0,255,192,0,8,8,1,0,2,0,0]);expect(clipboardImageSize(jpeg)).toEqual({width:512,height:256});expect(clipboardImageSize(jpeg.subarray(0,12))).toBeNull();
  });
  it("reads GIF and WebP canvas sizes and rejects unknown formats",()=>{
    const gif=Buffer.alloc(10);gif.write("GIF89a");gif.writeUInt16LE(300,6);gif.writeUInt16LE(200,8);expect(clipboardImageSize(gif)).toEqual({width:300,height:200});
    const webp=Buffer.alloc(30);webp.write("RIFF");webp.write("WEBP",8);webp.write("VP8X",12);webp.writeUIntLE(639,24,3);webp.writeUIntLE(479,27,3);expect(clipboardImageSize(webp)).toEqual({width:640,height:480});expect(clipboardImageSize(Buffer.from("not an image"))).toBeNull();
  });
});
