"""Build a clothed, animated BMX rider from Blender Studio's CC0 body base.
Usage: blender -b <human_base_meshes_bundle.blend> --python build-rider.py -- <output.glb>
Source bundle: https://download.blender.org/demo/asset-bundles/human-base-meshes/
Body Male - Realistic, Dan Ulrich, CC0 (verified collection asset metadata).
"""
import bpy, math, sys, bmesh, json
from pathlib import Path
dimensions=json.loads((Path(__file__).resolve().parents[2]/"src/data/privateBmxGeometry.json").read_text())
from mathutils import Vector, Matrix, Quaternion
source=bpy.data.objects['GEO-body_male_realistic']
# Use the anatomical base topology; smooth normals retain contours without a heavy subdivision mesh.
for modifier in source.modifiers:
 if modifier.type=='MULTIRES': modifier.levels=0
bpy.context.view_layer.update()
mesh=bpy.data.meshes.new_from_object(source.evaluated_get(bpy.context.evaluated_depsgraph_get()))
for o in list(bpy.data.objects): bpy.data.objects.remove(o,do_unlink=True)
body=bpy.data.objects.new('RaceSuit',mesh);bpy.context.collection.objects.link(body)
body.modifiers.clear()
body.location=(0,0,0)
# Remove sculpt-specific layers; the original base already has game-ready topology.
for p in mesh.polygons:p.use_smooth=True

def mat(name,color,rough=.6,metal=0):
 m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
 b=m.node_tree.nodes.get('Principled BSDF');b.inputs['Base Color'].default_value=(*color,1);b.inputs['Roughness'].default_value=rough;b.inputs['Metallic'].default_value=metal
 return m
jersey=mat('RiderColor',(0.7,.73,.76),.88);pants=mat('BallisticFabric',(.025,.032,.042),.85);trim=mat('ReflectivePanel',(.75,.79,.82),.48);glove=pants
for material in [jersey,pants,glove]:
 bsdf=material.node_tree.nodes.get('Principled BSDF');bsdf.inputs['Specular IOR Level'].default_value=.22;bsdf.inputs['Sheen Weight'].default_value=0;bsdf.inputs['Sheen Roughness'].default_value=.8
mesh.materials.clear()
for m in [jersey,pants,trim,glove]:mesh.materials.append(m)
for p in mesh.polygons:
 c=p.center
 z=sum(mesh.vertices[i].co.z for i in p.vertices)/len(p.vertices);x=sum(mesh.vertices[i].co.x for i in p.vertices)/len(p.vertices)
 p.material_index=0 if z>1.03 else 1
 if z<.16 or (abs(x)>.37 and z<1.00):p.material_index=3
 if .46<z<.57 and abs(x)>.075 and sum(mesh.vertices[i].co.y for i in p.vertices)/len(p.vertices)<-.025:p.material_index=3
# A small shell gives the uniform thickness rather than bare-body shading.
mesh.update()
for v in mesh.vertices:
 z=v.co.z;x=v.co.x
 folds=(.006*math.sin(z*105+x*26)*math.exp(-((z-1.075)/.085)**2) + .004*math.sin(z*125)*math.exp(-((z-.50)/.09)**2))
 v.co += v.normal * (.010+folds)
bm=bmesh.new();bm.from_mesh(mesh)
for layer in list(bm.verts.layers.deform.values()): bm.verts.layers.deform.remove(layer)
bm.to_mesh(mesh);bm.free()
# Build a simple deform rig; Blender heat weights retain anatomical mesh contours.
arm=bpy.data.armatures.new('BMXRiderSkeleton');rig=bpy.data.objects.new('BMXRider',arm);bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active=rig;body.select_set(False);rig.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
def bone(name,head,tail,parent=None):
 b=arm.edit_bones.new(name);b.head=head;b.tail=tail
 if parent:b.parent=arm.edit_bones[parent]
 return b
bone('pelvis',(0,0,.88),(0,0,1.07));bone('spine',(0,0,1.07),(0,0,1.36),'pelvis');bone('chest',(0,0,1.36),(0,0,1.48),'spine');bone('head',(0,0,1.48),(0,0,1.67),'chest')
for sign,side in [(1,'L'),(-1,'R')]:
 bone('thigh.'+side,(sign*.085,0,.91),(sign*.125,-.035,.50),'pelvis')
 bone('shin.'+side,(sign*.125,-.035,.50),(sign*.165,0,.105),'thigh.'+side)
 bone('foot.'+side,(sign*.165,0,.105),(sign*.165,-.16,.06),'shin.'+side)
 bone('upperarm.'+side,(sign*.18,0,1.39),(sign*.295,-.015,1.15),'chest')
 bone('forearm.'+side,(sign*.295,-.015,1.15),(sign*.39,-.035,.93),'upperarm.'+side)
 bone('hand.'+side,(sign*.39,-.035,.93),(sign*.41,-.035,.84),'forearm.'+side)
bpy.ops.object.mode_set(mode='OBJECT');body.select_set(True);rig.select_set(True);bpy.context.view_layer.objects.active=rig;bpy.ops.object.parent_set(type='ARMATURE_AUTO')
# Covered anatomy is replaced with fitted boots, closed gloves and a full-face helmet.
bm=bmesh.new();bm.from_mesh(mesh)
bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.0001)
bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
bmesh.ops.delete(bm,geom=[v for v in bm.verts if v.co.z<.13 or v.co.z>1.44 or (abs(v.co.x)>.33 and v.co.z<.90)],context='VERTS')
bmesh.ops.holes_fill(bm,edges=[e for e in bm.edges if e.is_boundary],sides=0)
bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
bm.to_mesh(mesh);bm.free()
# Helmet and shoes are explicit geometry, bound rigidly to the anatomical rig.
def uv(name,loc,scale,material):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=32,ring_count=16,location=loc);o=bpy.context.object;o.name=name;o.scale=scale;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(material)
 for f in o.data.polygons:f.use_smooth=True
 return o
def bind(o,b):
 # Coordinates are in the rest pose; an armature modifier follows the deform bone.
 g=o.vertex_groups.new(name=b);g.add(list(range(len(o.data.vertices))),1,'REPLACE');m=o.modifiers.new('Follow rider','ARMATURE');m.object=rig
shell=mat('HelmetShell',(.018,.022,.027),.30,.10);accent=jersey;glass=mat('GoggleLens',(.035,.055,.075),.12,.65)
uv('FullFaceHelmet',(0,-.006,1.607),(.111,.133,.135),shell)
# Reshape shell face using a dark recessed goggle insert and strong chin protection.
bind(bpy.context.object,'head')
o=uv('HelmetStripe',(0,-.006,1.607),(.038,.134,.137),accent);bind(o,'head')
o=uv('NeckCollar',(0,0,1.455),(.078,.080,.064),pants);bind(o,'chest')
o=uv('Goggles',(0,-.119,1.618),(.086,.025,.037),glass);bind(o,'head')
o=uv('ChinGuard',(0,-.105,1.545),(.098,.078,.036),shell);bind(o,'head')
o=uv('HelmetVisor',(0,-.085,1.71),(.12,.13,.012),shell);bind(o,'head')
# Sublimated team graphics follow the torso instead of floating in screen space.
def garment_text(name,text,location,rotation,size):
 bpy.ops.object.text_add(location=location,rotation=rotation)
 o=bpy.context.object;o.name=name;o.data.body=text;o.data.align_x='CENTER';o.data.size=size;o.data.extrude=.00015;o.data.offset=.0002;o.data.space_character=1.05;o.data.materials.append(trim)
 bpy.ops.object.convert(target='MESH');o=bpy.context.object
 bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
 wrap=o.modifiers.new('Printed on fabric','SHRINKWRAP');wrap.target=body;wrap.wrap_method='NEAREST_SURFACEPOINT';wrap.offset=.0015;bpy.ops.object.modifier_apply(modifier=wrap.name)
 bind(o,'spine')
garment_text('JerseyFront','TRACKLAB',(0,-.185,1.29),(math.pi/2,0,0),.043)
garment_text('JerseyBack','TRACKLAB',(0,.145,1.30),(math.pi/2,0,math.pi),.046)
garment_text('JerseyBackRacing','BMX RACING',(0,.145,1.25),(math.pi/2,0,math.pi),.022)
sole=pants
lace=trim
for sign,side in [(1,'L'),(-1,'R')]:
 o=uv('RaceShoe.'+side,(sign*.165,-.065,.078),(.060,.130,.056),glove)
 # Flatten the underside while retaining a rounded toe box.
 for v in o.data.vertices:v.co.z=max(v.co.z,-.040)
 bind(o,'foot.'+side)
 o=uv('ShoeSole.'+side,(sign*.165,-.065,.032),(.062,.133,.015),sole);bind(o,'foot.'+side)
 for i in range(5):
  o=uv('Laces.'+side+str(i),(sign*.165,-.015-i*.017,.129-i*.002),(.045,.003,.003),lace);bind(o,'foot.'+side)
o=uv('ChinVent',(0,-.176,1.55),(.063,.008,.012),glove);bind(o,'head')
# An analytic two-link cycle avoids IK pole flips and keeps contact points exact.
scene=bpy.context.scene;scene.render.fps=30;scene.frame_start=1;scene.frame_end=31
lean=Matrix.Rotation(math.radians(48),3,'X')
hip=Vector((0,.04,.90));restHip=Vector((0,0,.90))
def torso(v):return hip+lean@(Vector(v)-restHip)
def aim(name,head,tail):
 b=arm.bones[name];direction=(Vector(tail)-Vector(head)).normalized()
 q=(b.tail_local-b.head_local).normalized().rotation_difference(direction)@b.matrix_local.to_quaternion()
 rig.pose.bones[name].matrix=Matrix.LocRotScale(Vector(head),q,Vector((1,1,1)))
 bpy.context.view_layer.update()
def joint(a,b,l1,l2,pole):
 a,b=Vector(a),Vector(b);d=b-a;length=min(d.length,l1+l2-.0001);axis=d.normalized()
 along=(l1*l1-l2*l2+length*length)/(2*length)
 bend=Vector(pole)-a;bend=(bend-axis*bend.dot(axis)).normalized()
 return a+axis*along+bend*math.sqrt(max(0,l1*l1-along*along))
for o in bpy.context.scene.objects:
 for m in o.modifiers:
  if m.type=='ARMATURE':m.show_viewport=False
for frame in range(1,32):
 scene.frame_set(frame);angle=(frame-1)/30*math.tau
 for name in ['pelvis','spine','chest']:
  b=arm.bones[name];aim(name,torso(b.head_local),torso(b.tail_local))
 neck=torso(arm.bones['head'].head_local)
 aim('head',neck,neck+Vector((0,-.025,.19)))
 for sign,side,offset in [(1,'L',0),(-1,'R',math.pi)]:
  # Rest ankle-to-sole offset holds the shoe on the pedal, not below it.
  pedal=Vector((sign*.115,-math.sin(angle+offset)*dimensions["crankLength"],dimensions["bottomBracket"][1]+math.cos(angle+offset)*dimensions["crankLength"]))
  ankle=pedal+Vector((0,.065,.102))
  thigh=arm.bones['thigh.'+side];shin=arm.bones['shin.'+side]
  h=torso(thigh.head_local);k=joint(h,ankle,thigh.length,shin.length,(sign*.14,-1,.7))
  aim('thigh.'+side,h,k);aim('shin.'+side,k,ankle)
  foot=arm.bones['foot.'+side];aim('foot.'+side,ankle,ankle+foot.tail_local-foot.head_local)
  upper=arm.bones['upperarm.'+side];fore=arm.bones['forearm.'+side];hand=arm.bones['hand.'+side]
  shoulder=torso(upper.head_local)
  grip=Vector((sign*dimensions["grip"][2],-dimensions["grip"][0],dimensions["grip"][1]))
  wrist=grip+Vector((0,.04,.045))
  elbow=joint(shoulder,wrist,upper.length,fore.length,(sign*.8,-.2,1.2))
  aim('upperarm.'+side,shoulder,elbow);aim('forearm.'+side,elbow,wrist)
  aim('hand.'+side,wrist,grip)
 for p in rig.pose.bones:
  p.rotation_mode='QUATERNION';p.keyframe_insert('location',frame=frame);p.keyframe_insert('rotation_quaternion',frame=frame);p.keyframe_insert('scale',frame=frame)
rig.animation_data.action.name='PedalCycle'
scene.frame_set(1)
for o in bpy.context.scene.objects:
 for m in o.modifiers:
  if m.type=='ARMATURE':m.show_viewport=True
# Shape closed riding gloves around the bars in the posed stance, then return
# their vertices to bind space. Hand poses are fixed throughout the pedal cycle.
bpy.context.view_layer.update()
for sign,side in [(1,'L'),(-1,'R')]:
 b=rig.pose.bones['hand.'+side]
 inverse=(b.matrix@b.bone.matrix_local.inverted()).inverted()
 for name,loc,scale in [('GlovePalm',(sign*.33,-.435,.924),(.047,.041,.031)),('GloveFingers',(sign*.33,-.464,.899),(.046,.016,.024)),('GloveThumb',(sign*.33-sign*.038,-.408,.907),(.018,.032,.025))]:
  o=uv(name+'.'+side,loc,scale,glove)
  bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
  for v in o.data.vertices:v.co=inverse@v.co
  bind(o,'hand.'+side)
# Combine the skinned parts to keep draw calls low on phones and tablets.
bpy.ops.object.select_all(action='DESELECT')
for o in bpy.context.scene.objects:
 if o.type=='MESH':o.select_set(True)
bpy.context.view_layer.objects.active=body
bpy.ops.object.join()
out=sys.argv[sys.argv.index('--')+1]
bpy.ops.wm.save_as_mainfile(filepath=out.replace('/src/assets/private-stadium/rider.glb','/output/private-stadium/rider.blend'))
bpy.ops.export_scene.gltf(filepath=out,export_format='GLB',export_animations=True,export_animation_mode='ACTIONS',export_frame_range=True,export_skins=True,export_apply=False,export_morph=False)
print('EXPORTED',out)
