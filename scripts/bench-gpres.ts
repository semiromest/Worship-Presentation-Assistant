/** Matched separate-process peak-RSS comparison. Synthetic uncompressible media;
 * not a complete Electron startup or physical disk durability benchmark. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeGpresFile } from '../src/main/gpresWriter';
import { buildGpresZip } from '../src/shared/mediaTree';

async function main() {
 const mode=process.argv[2],root=path.resolve('.tmp/gpres-bench');await fs.mkdir(root,{recursive:true});
 if(mode==='legacy'||mode==='stream') {
  const content=await fs.readFile(path.join(root,'fixture.json'),'utf8'),file=path.join(root,`${mode}.gpres`),start=performance.now();
  await fs.unlink(file).catch(()=>{});
  let bytes:number;
  if(mode==='legacy'){const {zip}=await buildGpresZip(JSON.parse(content));const buffer=zip.toBuffer();bytes=buffer.length;await fs.writeFile(file,buffer);}
  else bytes=(await writeGpresFile(content,file,path.join(root,'library'))).bytes;
  const result={mode,elapsedMs:performance.now()-start,peakRssMiB:process.resourceUsage().maxRSS/1024,outputBytes:bytes};
  await fs.unlink(file);process.stdout.write(JSON.stringify(result));return;
 }
 const block=randomBytes(2*1024*1024),slides=[];
 for(let i=0;i<64;i++){block.writeUInt32LE(i,0);const file=path.join(root,`media-${i}.png`);await fs.writeFile(file,block);slides.push({id:`s${i}`,type:'image',content:'',mediaUrl:pathToFileURL(file).href});}
 await fs.writeFile(path.join(root,'fixture.json'),JSON.stringify({id:'benchmark',name:'128 MiB media benchmark',slides}));
 const runs=[];for(let i=0;i<3;i++)for(const variant of ['legacy','stream']){const {stdout}=await promisify(execFile)(process.execPath,[...process.execArgv,path.resolve(process.argv[1]),variant],{maxBuffer:1024*1024});const result={run:i,...JSON.parse(stdout)};runs.push(result);console.log(JSON.stringify(result));}
 await fs.writeFile(path.join(root,'summary.json'),JSON.stringify({date:new Date().toISOString(),mediaFiles:64,sourceBytes:128*1024*1024,method:'Separate Node processes; streaming writer includes full manifest/hash readback validation; legacy writes in-memory AdmZip; synthetic random bytes with .png extension, no image decoding; resourceUsage maxRSS; OS cache not controlled',runs},null,2));
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
