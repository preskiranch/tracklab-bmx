import { stadiumProgress, stadiumCadence } from './privateStadiumMath';
import riderUrl from '../assets/private-stadium/rider.glb?url';
import lightingUrl from '../assets/private-stadium/outdoor-light.hdr?url';
import asphaltColorUrl from '../assets/private-stadium/asphalt-color.jpg?url';
import asphaltNormalUrl from '../assets/private-stadium/asphalt-normal.jpg?url';
import asphaltRoughnessUrl from '../assets/private-stadium/asphalt-roughness.jpg?url';
import stadiumUrl from '../assets/private-stadium/stadium.png?url';
import bikeDimensions from '../data/privateBmxGeometry.json';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { createStadiumBike } from './privateStadiumBike';
import type { ArenaRider } from '../components/DragStripGameArenaLayer';
import type { RaceState } from '../types';

export type StadiumFrame = {riders:ArenaRider[]; raceDistanceMeters:number; raceState:RaceState; startGatePhase:string};
const RUN=26, START=1;
export async function createPrivateStadiumScene(canvas:HTMLCanvasElement) {
  const renderer=new T.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(1.5,window.devicePixelRatio||1));
  renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=.9;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
  const scene=new T.Scene();scene.background=new T.Color('#9bb6c6');
  const camera=new T.OrthographicCamera(-18,18,9,-9,.1,180);
  camera.position.set(14,20,23);camera.lookAt(14,0,0);
  const hemisphere=new T.HemisphereLight('#dcecff','#343b35',.35);scene.add(hemisphere);
  const sun=new T.DirectionalLight('#ffebcd',1.6);sun.position.set(-8,18,-10);sun.target.position.set(14,0,0);scene.add(sun,sun.target);
  sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-25;sun.shadow.camera.right=25;sun.shadow.camera.top=18;sun.shadow.camera.bottom=-18;sun.shadow.camera.far=70;sun.shadow.normalBias=.02;sun.shadow.bias=-.00015;
  const pmrem=new T.PMREMGenerator(renderer);
  let environment:T.WebGLRenderTarget;
  try { const hdr=await new RGBELoader().loadAsync(lightingUrl);environment=pmrem.fromEquirectangular(hdr);hdr.dispose(); }
  catch(error){pmrem.dispose();renderer.dispose();throw error;}
  scene.environment=environment.texture;scene.environmentIntensity=.8;pmrem.dispose();
  const geometry=new Set<T.BufferGeometry>(),materials=new Set<T.Material>(),textures=new Set<T.Texture>();
  const textureLoader=new T.TextureLoader();
  const load=(name:string,color=false)=>textureLoader.loadAsync(name).then(t=>{
    t.wrapS=t.wrapT=T.RepeatWrapping;t.repeat.set(12,5);t.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());
    if(color)t.colorSpace=T.SRGBColorSpace;textures.add(t);return t;
  });
  const [modelResult,mapResult]=await Promise.allSettled([
    new GLTFLoader().loadAsync(riderUrl),
    Promise.all([load(asphaltColorUrl,true),load(asphaltNormalUrl),load(asphaltRoughnessUrl)]),
  ] as const);
  if(modelResult.status==='rejected'||mapResult.status==='rejected'){
    if(modelResult.status==='fulfilled')disposeModel(modelResult.value.scene);
    renderer.dispose();environment.dispose();textures.forEach(t=>t.dispose());
    throw new Error('The private stadium assets could not be loaded.');
  }
  const model=modelResult.value,maps=mapResult.value;
  const asphalt=new T.MeshStandardMaterial({color:'#555555',map:maps[0],normalMap:maps[1],roughnessMap:maps[2],roughness:1,normalScale:new T.Vector2(.65,.65)});materials.add(asphalt);
  function add(g:T.BufferGeometry,m:T.Material,x:number,y:number,z:number){geometry.add(g);materials.add(m);const mesh=new T.Mesh(g,m);mesh.position.set(x,y,z);scene.add(mesh);return mesh;}
  const turfMaterial=asphalt.clone();turfMaterial.color.set('#796f60');
  const turf=add(new T.PlaneGeometry(180,180),turfMaterial,14,-.04,0);turf.rotation.x=-Math.PI/2;turf.receiveShadow=true;
  const road=add(new T.PlaneGeometry(38,17),asphalt,14,0,0);road.rotation.x=-Math.PI/2;road.receiveShadow=true;
  const white=new T.MeshStandardMaterial({color:'#e5e3d7',roughness:.88});
  const dark=new T.MeshStandardMaterial({color:'#161c20',roughness:.85});
  const concrete=new T.MeshStandardMaterial({color:'#aaa99f',roughness:.95});
  for(let lane=0;lane<=4;lane++){
    const stripe=add(new T.PlaneGeometry(31,.055),white,14,.012,-6+lane*3);stripe.rotation.x=-Math.PI/2;
  }
  for(const x of [START,START+RUN]){
    const line=add(new T.PlaneGeometry(.08,12),white,x,.014,0);line.rotation.x=-Math.PI/2;
  }
  for(let i=0;i<40;i++)for(let j=0;j<2;j++){
    const square=add(new T.PlaneGeometry(.2,.3),(i+j)%2?dark:white,START+RUN+j*.2,.016,-5.85+i*.3);square.rotation.x=-Math.PI/2;
  }
  // Trackside walls, rails, light masts and seating are genuine scene geometry.
  for(const side of [-1,1]){
    const wall=add(new T.BoxGeometry(37,.4,.28),concrete,14,.2,side*7);wall.castShadow=wall.receiveShadow=true;
    const rail=add(new T.BoxGeometry(37,.07,.07),dark,14,.88,side*7);rail.castShadow=true;
    for(let i=0;i<12;i++)add(new T.CylinderGeometry(.025,.025,.8,6),dark,-3+i*3.1,.45,side*7);
  }
  // Backdrop remains outside the playable surface and does not drive the camera.
  const backdrop=await new T.TextureLoader().loadAsync(stadiumUrl).catch(()=>null);
  if(backdrop){backdrop.colorSpace=T.SRGBColorSpace;backdrop.repeat.set(1,.4);backdrop.offset.set(0,.6);textures.add(backdrop);
    add(new T.PlaneGeometry(60,14),new T.MeshBasicMaterial({map:backdrop}),14,7,-9);
  }
  function label(text:string,x:number,z:number){
    const c=document.createElement('canvas');c.width=512;c.height=128;const ctx=c.getContext('2d')!;
    ctx.fillStyle='#121a22';ctx.fillRect(0,0,512,128);ctx.fillStyle='#eef4f6';ctx.font='bold 56px sans-serif';ctx.textAlign='center';ctx.fillText(text,256,85);
    const texture=new T.CanvasTexture(c);texture.colorSpace=T.SRGBColorSpace;textures.add(texture);
    const board=add(new T.PlaneGeometry(2.9,.725),new T.MeshBasicMaterial({map:texture,side:T.DoubleSide}),x,1.45,z);
    add(new T.CylinderGeometry(.03,.03,1.2,6),dark,x,.6,z);return board;
  }
  label('START',START,-6.65);label('FINISH',START+RUN,-6.65);
  scene.updateMatrixWorld(true);
  const batches=new Map<T.Material,T.Mesh[]>();
  scene.children.filter((o):o is T.Mesh=>o instanceof T.Mesh && !Array.isArray(o.material)).forEach(o=>{
    const m=o.material as T.Material;batches.set(m,[...(batches.get(m)??[]),o]);
  });
  batches.forEach((meshes,material)=>{
    if(meshes.length<2)return;
    const parts=meshes.map(m=>m.geometry.clone().applyMatrix4(m.matrixWorld));
    const merged=mergeGeometries(parts);parts.forEach(p=>p.dispose());if(!merged)return;
    geometry.add(merged);const batch=new T.Mesh(merged,material);batch.castShadow=meshes.some(m=>m.castShadow);batch.receiveShadow=meshes.some(m=>m.receiveShadow);
    meshes.forEach(m=>scene.remove(m));scene.add(batch);
  });
  const weaveData=new Uint8Array(64*64*4);
  for(let y=0;y<64;y++)for(let x=0;x<64;x++){const i=(y*64+x)*4;const n=((x%4===0)!==(y%4===0))?170:110;weaveData[i]=weaveData[i+1]=weaveData[i+2]=n;weaveData[i+3]=255;}
  const weave=new T.DataTexture(weaveData,64,64);weave.wrapS=weave.wrapT=T.RepeatWrapping;weave.repeat.set(24,24);weave.generateMipmaps=true;weave.minFilter=T.LinearMipmapLinearFilter;weave.magFilter=T.LinearFilter;weave.needsUpdate=true;textures.add(weave);
  const gates:T.Group[]=[];
  let gateAngle=0;
  for(let i=0;i<4;i++){
    const plate=add(new T.BoxGeometry(.035,.30,2.75),new T.MeshStandardMaterial({color:'#a7afb4',metalness:.8,roughness:.45}),0,.15,0);
    const hinge=new T.Group();hinge.position.set(START,.02,-4.5+i*3);hinge.add(plate);scene.add(hinge);plate.castShadow=true;gates.push(hinge);
  }
  type Entry={root:T.Group;human:T.Object3D;mixer:T.AnimationMixer;bike:ReturnType<typeof createStadiumBike>;phase:number;progress:number;materials:T.Material[]};
  const entries=new Map<string,Entry>();
  let lastState:RaceState|undefined;
  let inspection=false;
  const resize=()=>{
    const {width,height}=canvas.getBoundingClientRect();if(width<1||height<1)return;
    renderer.setSize(width,height,false);
    if(inspection){
      const first=entries.values().next().value;const x=first?.root.position.x??1;const z=first?.root.position.z??-4.5;
      camera.up.set(0,1,0);camera.position.set(x+2,2.8,z+4.5);camera.lookAt(x,1,z);
      const h=4;camera.left=-h*width/height/2;camera.right=h*width/height/2;camera.top=h/2;camera.bottom=-h/2;camera.updateProjectionMatrix();return;
    }
    camera.position.set(14,18,23);
    const portrait=height>width*1.1;
    camera.up.set(portrait?1:0,portrait?0:1,0);camera.lookAt(14,0,-2);camera.updateMatrixWorld();
    const aspect=width/height, baseWidth=portrait?15:35, baseHeight=portrait?35:15;
    const h=Math.max(baseHeight,baseWidth/aspect);camera.left=-h*aspect/2;camera.right=h*aspect/2;camera.top=h/2;camera.bottom=-h/2;camera.updateProjectionMatrix();
    canvas.dataset.orientation=portrait?'portrait':'landscape';
  };
  resize();const observer=new ResizeObserver(resize);observer.observe(canvas);
  const update=(state:StadiumFrame,dt:number)=>{
    if(inspection && state.raceState==='racing'){inspection=false;resize();}
    const reset=state.raceState!==lastState;lastState=state.raceState;
    const active=new Set(state.riders.map(r=>r.id));
    entries.forEach((entry,id)=>{if(!active.has(id)){scene.remove(entry.root);entry.mixer.stopAllAction();entry.bike.dispose();entry.materials.forEach(m=>m.dispose());entries.delete(id);}});
    for(const rider of state.riders){
      let entry=entries.get(rider.id);
      if(!entry){
        const root=new T.Group();root.scale.setScalar(1.3);root.position.z=-4.5+(rider.playerId-1)*3+(rider.ghost?.55:0);
        const human=clone(model.scene);human.rotation.y=Math.PI/2;
        const clonedMaterials:T.Material[]=[];
        human.traverse(o=>{if(o instanceof T.Mesh){o.castShadow=true;o.receiveShadow=true;o.frustumCulled=false;
          const remap=(original:T.Material)=>{const material=original.clone();clonedMaterials.push(material);
            if(material instanceof T.MeshStandardMaterial){if(['RiderColor','HelmetColor'].includes(material.name))material.color.set(rider.ghost?'#ff8c22':rider.accent);material.envMapIntensity=.3;
              if(['RiderColor','BallisticFabric','GloveRubber'].includes(material.name)){material.roughness=.95;material.bumpMap=weave;material.bumpScale=.002;material.envMapIntensity=.12;if(material.name==='RiderColor')material.color.multiplyScalar(.36);} }
            if(rider.ghost){material.transparent=true;material.opacity=.45;}return material;};
          o.material=Array.isArray(o.material)?o.material.map(remap):remap(o.material);
        }});
        const bike=createStadiumBike(rider.accent,rider.playerId);
        if(rider.ghost)bike.root.traverse(o=>{if(o instanceof T.Mesh || o instanceof T.LineSegments){for(const m of Array.isArray(o.material)?o.material:[o.material]){m.transparent=true;m.opacity=.3;}}});
        root.add(human,bike.root);scene.add(root);
        const mixer=new T.AnimationMixer(human);if(model.animations[0])mixer.clipAction(model.animations[0]).play();
        entry={root,human,mixer,bike,phase:0,progress:0,materials:clonedMaterials};entries.set(rider.id,entry);
      }
      const target=stadiumProgress(rider.distanceMeters,state.raceDistanceMeters);
      entry.progress=reset||target<entry.progress||rider.finishedAt!=null?target:T.MathUtils.damp(entry.progress,target,18,dt);
      // Coordinate is the front tyre's leading edge, matching the timing model.
      entry.root.visible=!inspection || entry===entries.values().next().value;
      entry.root.position.x=START+RUN*entry.progress-(bikeDimensions.frontAxle[0]+bikeDimensions.wheelRadius)*1.3;
      const moving=state.raceState==='racing'&&rider.finishedAt==null&&!rider.disqualified;
      if(moving)entry.phase+=dt*stadiumCadence(rider.cadenceRpm)/60*Math.PI*2;
      entry.mixer.setTime((entry.phase/(Math.PI*2))%1);
      entry.bike.update(rider.distanceMeters,-entry.phase);
    }
    const down=state.raceState==='racing'||state.raceState==='finished'||state.startGatePhase==='go';
    // Rotate around the ground hinge instead of teleporting the gate through the surface.
    gateAngle=down?Math.max(-Math.PI/2,gateAngle-dt*Math.PI*5):0;
    gates.forEach(g=>{g.rotation.z=gateAngle;});
    renderer.render(scene,camera);canvas.dataset.painted='true';canvas.dataset.drawCalls=String(renderer.info.render.calls);canvas.dataset.triangles=String(renderer.info.render.triangles);
  };
  return {update,setInspection:(value:boolean)=>{inspection=value;resize();},dispose:()=>{
    observer.disconnect();entries.forEach(e=>{e.mixer.stopAllAction();e.bike.dispose();e.materials.forEach(m=>m.dispose());});
    disposeModel(model.scene);
    geometry.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());environment.dispose();renderer.dispose();
  }};
}

function disposeModel(root:T.Object3D) {
  const geometries=new Set<T.BufferGeometry>(),materials=new Set<T.Material>(),textures=new Set<T.Texture>();
  root.traverse(o=>{if(o instanceof T.Mesh){geometries.add(o.geometry);(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>{materials.add(m);Object.values(m).forEach(v=>{if(v instanceof T.Texture)textures.add(v);});});}});
  geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());
}
