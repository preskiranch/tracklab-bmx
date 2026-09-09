import { drawUprightRiderCanvas } from '../../../src/components/GoogleMapsTrackLayer';
import { riderFallbackRigBaseAssetByColor } from '../../../src/lib/riderAssets';
import { canonicalPlayerAccent } from '../../../src/lib/playerPalette';
import type { PlayerSlot } from '../../../src/types';
document.body.style.cssText='font:16px system-ui;background:#ddd;color:#111;margin:12px';
const colors=['lime','blue','red','yellow'] as const;
const host=document.getElementById('riders')!;
host.style.cssText='max-width:650px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px';
for (const [i,color] of colors.entries()) {
 const canvas=document.createElement('canvas'); canvas.style.cssText='width:100%;background:#eee;border:1px solid #888';host.append(canvas);
 canvas.setAttribute('aria-label',color==='lime'?'Evergreen rider':color+' rider');
 const image=new Image(); image.src=riderFallbackRigBaseAssetByColor[color];
 const player={id:i+1,colorName:color,accent:canonicalPlayerAccent(color),name:'Demo rider',deviceId:null} as PlayerSlot;
 image.onload=()=>{const frame=(time:number)=>{drawUprightRiderCanvas(canvas,image,player,(time/30)%360,{crankAngleRadians:time/150,crankStep:0,pedaling:true,wheelFrameIndex:Math.floor(time/100)%4});requestAnimationFrame(frame)};requestAnimationFrame(frame)};
}
