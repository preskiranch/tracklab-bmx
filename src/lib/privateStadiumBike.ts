import dimensions from '../data/privateBmxGeometry.json';
import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** A component-level BMX race bike: metal frame, fork, spokes, rubber tyres,
 * chainring, chain, pedals, bars, stem, saddle and grips. Forward axis is +X. */
export function createStadiumBike(accent: string, playerId = 1) {
  const root = new T.Group();
  const metal = new T.MeshStandardMaterial({color:'#b6c0c8',metalness:.95,roughness:.25});
  const frameMaterial = new T.MeshPhysicalMaterial({color:accent,metalness:.65,roughness:.3,clearcoat:1,clearcoatRoughness:.2});
  const rubber = new T.MeshStandardMaterial({color:'#111416',roughness:.92});
  const black = new T.MeshStandardMaterial({color:'#1c2228',metalness:.7,roughness:.4});
  const spokeMaterial = new T.LineBasicMaterial({color:'#8b959c'});
  const materials:T.Material[]=[metal,frameMaterial,rubber,black,spokeMaterial];
  const geometries = new Set<T.BufferGeometry>();
  const textures:T.Texture[]=[];
  function mesh(g:T.BufferGeometry,m:T.Material,parent:T.Object3D=root) {
    geometries.add(g);const o=new T.Mesh(g,m);o.castShadow=true;o.receiveShadow=true;parent.add(o);return o;
  }
  const v=(x:number,y:number,z=0)=>new T.Vector3(x,y,z);
  function tube(a:T.Vector3,b:T.Vector3,r:number,m:T.Material,parent:T.Object3D=root) {
    const o=mesh(new T.CylinderGeometry(r,r,a.distanceTo(b),12),m,parent);
    o.position.copy(a).add(b).multiplyScalar(.5);o.quaternion.setFromUnitVectors(v(0,1),b.clone().sub(a).normalize());return o;
  }
  // Metres: 406 mm rims / ~20-inch tyres, 945 mm wheelbase, 533 mm top tube.
  // Adult BMX race proportions checked against the Chase Edge Pro XL geometry.
  const point=(a:number[])=>v(a[0],a[1],a[2]);
  const rear=point(dimensions.rearAxle),front=point(dimensions.frontAxle),crank=point(dimensions.bottomBracket),seat=point(dimensions.seatTubeTop),head=point(dimensions.headTubeTop);
  const crown=point(dimensions.forkCrown);
  tube(head,crown,.023,frameMaterial);
  [[seat,crank],[crank,crown],[seat,head]].forEach(([a,b])=>tube(a,b,.028,frameMaterial));
  for(const side of [-1,1]) {
    tube(rear.clone().add(v(0,0,side*.065)),crank.clone().add(v(0,0,side*.06)),.017,frameMaterial);
    tube(seat,rear.clone().add(v(0,0,side*.065)),.018,frameMaterial);
    tube(crown.clone().add(v(0,0,side*.05)),front.clone().add(v(0,0,side*.05)),.016,black);
  }
  const wheels=[rear,front].map((at)=>{
    const wheel=new T.Group();wheel.position.copy(at);root.add(wheel);
    mesh(new T.TorusGeometry(.228,.022,12,48),rubber,wheel);
    mesh(new T.TorusGeometry(.207,.010,8,48),black,wheel);
    mesh(new T.TorusGeometry(.207,.003,6,48),metal,wheel).position.z=.013;
    tube(v(0,0,-.055),v(0,0,.055),.014,metal,wheel);
    for(const side of [-1,1]){tube(v(0,0,side*.027),v(0,0,side*.032),.026,metal,wheel);tube(v(0,0,side*.056),v(0,0,side*.064),.008,black,wheel);}
    const points:T.Vector3[]=[];
    for(let i=0;i<36;i++) {
      const a=i*Math.PI/18,offset=i%2?-.022:.022;
      points.push(v(Math.cos(a+.3)*.03,Math.sin(a+.3)*.03,offset),v(Math.cos(a)*.202,Math.sin(a)*.202,0));
    }
    const g=new T.BufferGeometry().setFromPoints(points);geometries.add(g);wheel.add(new T.LineSegments(g,spokeMaterial));
    const treadGeometry=new T.BoxGeometry(.006,.0006,.032);geometries.add(treadGeometry);
    const tread=new T.InstancedMesh(treadGeometry,rubber,60);const dummy=new T.Object3D();
    for(let i=0;i<60;i++){const a=i*Math.PI/30;dummy.position.set(Math.cos(a)*.2502,Math.sin(a)*.2502,0);dummy.rotation.z=a-Math.PI/2;dummy.updateMatrix();tread.setMatrixAt(i,dummy.matrix);}
    wheel.add(tread);return wheel;
  });
  tube(seat,v(-.093,.58),.014,metal);
  const saddle=mesh(new T.SphereGeometry(1,20,12),rubber);saddle.scale.set(.115,.025,.057);saddle.position.set(-.105,.595,0);
  // Short 50 mm stem and an 8-inch-rise BMX bar, including its crossbar.
  tube(head,v(.431,.693),.015,black);tube(v(.431,.693),v(.481,.699),.021,black);
  for(const sign of [-1,1]) {
    tube(v(.481,.699,sign*.04),v(.477,.765,sign*.12),.011,black);
    tube(v(.477,.765,sign*.12),v(.47,.894,sign*.21),.011,black);
    tube(v(.47,.894,sign*.21),v(.43,.902,sign*.356),.011,black);
    tube(v(.46,.896,sign*.23),v(.43,.902,sign*.356),.016,rubber);
  }
  tube(v(.474,.80,-.148),v(.474,.80,.148),.008,black);
  // Front-facing race plate and the frame's own graphics.
  const plateCanvas=document.createElement('canvas');plateCanvas.width=256;plateCanvas.height=192;
  const plateContext=plateCanvas.getContext('2d')!;
  plateContext.fillStyle='#eee9dd';plateContext.fillRect(0,0,256,192);
  plateContext.strokeStyle='#161a1d';plateContext.lineWidth=12;plateContext.strokeRect(6,6,244,180);
  plateContext.fillStyle='#161a1d';plateContext.textAlign='center';plateContext.font='900 120px Arial';plateContext.fillText(String(playerId),128,143);
  plateContext.font='bold 20px Arial';plateContext.fillText('TRACKLAB',128,32);
  const plateTexture=new T.CanvasTexture(plateCanvas);plateTexture.colorSpace=T.SRGBColorSpace;textures.push(plateTexture);
  const plateMaterial=new T.MeshStandardMaterial({map:plateTexture,roughness:.8,side:T.DoubleSide});materials.push(plateMaterial);
  const plate=mesh(new T.PlaneGeometry(.235,.17),plateMaterial);plate.position.set(.492,.819,0);plate.rotation.y=Math.PI/2;
  const decalCanvas=document.createElement('canvas');decalCanvas.width=512;decalCanvas.height=64;
  const decalContext=decalCanvas.getContext('2d')!;decalContext.fillStyle='#e6e9e7';decalContext.font='italic 900 54px Arial';decalContext.fillText('TRACKLAB',8,51);
  const decalTexture=new T.CanvasTexture(decalCanvas);decalTexture.colorSpace=T.SRGBColorSpace;textures.push(decalTexture);
  const decalMaterial=new T.MeshStandardMaterial({map:decalTexture,transparent:true,roughness:.5,depthWrite:false,side:T.DoubleSide});materials.push(decalMaterial);
  for(const side of [-1,1]){const decal=mesh(new T.PlaneGeometry(.36,.045),decalMaterial);decal.position.set(.24,.41,side*.029);decal.rotation.z=Math.atan2(.234,.478);decal.castShadow=false;}
  const rotor=mesh(new T.RingGeometry(.037,.070,36),metal);rotor.position.copy(rear).add(v(0,0,-.061));
  // A BMX rear brake: handlebar lever, continuous housing and rear caliper.
  tube(v(.452,.895,-.24),v(.487,.875,-.25),.006,metal);
  tube(v(.487,.875,-.25),v(.49,.865,-.32),.005,metal);
  const housing=new T.CatmullRomCurve3([
    v(.487,.875,-.25),v(.55,.77,-.16),v(.51,.62,-.06),
    v(.21,.58,-.04),v(-.075,.52,-.045),v(-.30,.31,-.07)
  ]);
  mesh(new T.TubeGeometry(housing,32,.003,5,false),rubber);
  const caliper=mesh(new T.BoxGeometry(.045,.042,.028),black);caliper.position.copy(rear).add(v(.042,.038,-.063));
  // Chain stays in the plane of the right-hand sprockets.
  const chainPath=new T.Path();chainPath.moveTo(-.357,.282);chainPath.lineTo(0,.379);
  chainPath.absarc(0,.292,.087,Math.PI/2,-Math.PI/2,true);chainPath.lineTo(-.357,.218);
  chainPath.absarc(-.357,.25,.032,-Math.PI/2,-3*Math.PI/2,true);
  const chainPoints=chainPath.getSpacedPoints(124);
  const linkGeometry=new T.TorusGeometry(.0037,.0012,4,8);geometries.add(linkGeometry);
  const links=new T.InstancedMesh(linkGeometry,metal,124);links.name='ChainLinks';links.castShadow=true;root.add(links);const linkTransform=new T.Object3D();
  for(let i=0;i<124;i++){const a=chainPoints[i],b=chainPoints[i+1];linkTransform.position.set(a.x,a.y,.071+(i%2?-.001:.001));linkTransform.rotation.z=Math.atan2(b.y-a.y,b.x-a.x);linkTransform.scale.set(1.5,1,.7);linkTransform.updateMatrix();links.setMatrixAt(i,linkTransform.matrix);}
  const cranks=new T.Group();cranks.position.copy(crank);root.add(cranks);
  const gearShape=new T.Shape();
  for(let i=0;i<172;i++){const a=i*Math.PI*2/172,r=i%4===1||i%4===2?.089:.085;const x=Math.cos(a)*r,y=Math.sin(a)*r;if(i===0)gearShape.moveTo(x,y);else gearShape.lineTo(x,y);}gearShape.closePath();
  const gearHole=new T.Path();gearHole.absarc(0,0,.065,0,Math.PI*2,true);gearShape.holes.push(gearHole);
  mesh(new T.ExtrudeGeometry(gearShape,{depth:.004,bevelEnabled:false,curveSegments:32}),black,cranks).position.z=.073;
  for(let i=0;i<4;i++){const a=i*Math.PI/2;tube(v(Math.cos(a)*.012,Math.sin(a)*.012,.075),v(Math.cos(a)*.076,Math.sin(a)*.076,.075),.006,black,cranks);}
  const pedals:T.Object3D[]=[];
  for(const sign of [-1,1]) {
    tube(v(0,0,sign*.075),v(0,-sign*dimensions.crankLength,sign*.075),.012,metal,cranks);
    const pedal=new T.Group();cranks.add(pedal);pedal.position.set(0,-sign*dimensions.crankLength,sign*.12);pedals.push(pedal);
    // Open platform with grip pins rather than a solid rectangular block.
    for(const edge of [-1,1]){
      const rail=mesh(new T.BoxGeometry(.11,.018,.012),black,pedal);rail.position.z=edge*.038;
      const end=mesh(new T.BoxGeometry(.012,.018,.085),black,pedal);end.position.x=edge*.049;
      for(const x of [-.038,0,.038])tube(v(x,.008,edge*.034),v(x,.014,edge*.034),.002,metal,pedal);
    }
    tube(v(0,0,-.04),v(0,0,.04),.007,metal,pedal);
  }
  const shadowCanvas=document.createElement('canvas');shadowCanvas.width=128;shadowCanvas.height=64;
  const shadowContext=shadowCanvas.getContext('2d')!;const shadowGradient=shadowContext.createRadialGradient(64,32,3,64,32,62);
  shadowGradient.addColorStop(0,'rgba(0,0,0,.25)');shadowGradient.addColorStop(1,'rgba(0,0,0,0)');shadowContext.fillStyle=shadowGradient;shadowContext.fillRect(0,0,128,64);
  const shadowTexture=new T.CanvasTexture(shadowCanvas);textures.push(shadowTexture);
  const shadowMaterial=new T.MeshBasicMaterial({map:shadowTexture,transparent:true,depthWrite:false});materials.push(shadowMaterial);
  const contactShadow=mesh(new T.PlaneGeometry(1.55,.42),shadowMaterial);contactShadow.position.set(.115,.003,0);contactShadow.rotation.x=-Math.PI/2;contactShadow.castShadow=false;contactShadow.receiveShadow=false;
  // Batch only static meshes. Instanced chain links and counter-rotating
  // pedals must keep their own transforms and cannot enter these batches.
  const batchStatic=(group:T.Group,excluded:T.Object3D[]=[])=>{
    group.updateMatrix();
    const batches=new Map<T.Material,T.Mesh[]>();
    for(const o of group.children){
      if(!(o instanceof T.Mesh)||o instanceof T.InstancedMesh||Array.isArray(o.material)||excluded.includes(o))continue;
      o.updateMatrix();batches.set(o.material,[...(batches.get(o.material)??[]),o]);
    }
    for(const [material,meshes] of batches){
      if(meshes.length<2)continue;
      const parts=meshes.map(m=>m.geometry.clone().applyMatrix4(m.matrix));const merged=mergeGeometries(parts);parts.forEach(p=>p.dispose());
      if(!merged)continue;
      geometries.add(merged);meshes.forEach(m=>group.remove(m));const batch=new T.Mesh(merged,material);batch.castShadow=meshes.some(m=>m.castShadow);batch.receiveShadow=meshes.some(m=>m.receiveShadow);group.add(batch);
    }
  };
  wheels.forEach(w=>batchStatic(w));pedals.forEach(p=>batchStatic(p as T.Group));batchStatic(cranks,pedals);batchStatic(root);
  return {root,update:(distance:number,phase:number)=>{
    const safeDistance=Number.isFinite(distance)?Math.max(0,distance):0;
    const safePhase=Number.isFinite(phase)?phase:0;
    wheels.forEach(w=>w.rotation.z=-safeDistance/dimensions.wheelRadius);cranks.rotation.z=safePhase;
    pedals.forEach(p=>p.rotation.z=-safePhase);
  },dispose:()=>{geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());}};
}
