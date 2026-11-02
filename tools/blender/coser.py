"""Cose las piezas del molde (piezas.json) sobre un cuerpo invisible con el
simulador de tela de Blender y guarda la forma final.

    python coser.py piezas.json salida.json salida.blend [opciones JSON]

Coordenadas de Blender: z arriba, el frente mira a -y. z = 0 es el punto del
cuello de la camiseta; el cuerpo es el maniquí de tools/template/body.py
agrandado al talle del molde.
"""
import json
import math
import os
import sys
import time

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'template'))
import body as maniqui  # noqa: E402


def ellipse_table(a, b, n=4000):
    ts, arc = [0.0], [0.0]
    px, py = 0.0, b
    for i in range(1, n + 1):
        t = math.pi * i / n
        x, y = a * math.sin(t), b * math.cos(t)
        arc.append(arc[-1] + math.hypot(x - px, y - py))
        ts.append(t)
        px, py = x, y
    return ts, arc


def arc_to_t(ts, arc, s):
    sg = 1 if s >= 0 else -1
    s = min(abs(s), arc[-1])
    lo, hi = 0, len(arc) - 1
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if arc[mid] < s:
            lo = mid
        else:
            hi = mid
    f = (s - arc[lo]) / ((arc[hi] - arc[lo]) or 1)
    return sg * (ts[lo] + f * (ts[hi] - ts[lo]))


def build_body(scene, o):
    sx, sy = o['body_sx'], o['body_sy']
    maniqui.TORSO = [(y * sy, a * sx, b * sx, c * sx) for y, a, b, c in maniqui.TORSO]
    maniqui.ARM = [(s * sy, r * o['arm_s']) for s, r in maniqui.ARM]
    objs = [maniqui._object(scene, 'cuerpo', *maniqui.torso_mesh())]
    alpha = math.radians(o['arm_angle'])
    for side in (1, -1):
        arm = maniqui._object(scene, 'brazoL' if side > 0 else 'brazoR', *maniqui.arm_mesh())
        arm.location = (side * o['joint_x'], 0.0, o['joint_z'])
        arm.rotation_euler = (0.0, -side * alpha, 0.0)
        objs.append(arm)
    for ob in objs:
        ob.modifiers.new('col', 'COLLISION')
        ob.collision.thickness_outer = o['body_thick']
        ob.collision.thickness_inner = 0.02
        ob.collision.cloth_friction = o['body_friction']
        ob.collision.damping = 0.5
    return objs


def torso_halfwidth(z):
    return maniqui._catmull(maniqui.TORSO, z, 1)


def initial_positions(data, o):
    u = data['unit_m']
    P = {pc['key']: pc for pc in data['pieces']}
    pos = [None] * sum(len(pc['uv']) for pc in data['pieces'])
    ts, arc = ellipse_table(o['wrap_a'], o['wrap_b'])
    for key in ('front', 'back'):
        pc = P[key]
        lab = pc['labels']
        cx = (lab['NPa'][0] + lab['NPb'][0]) / 2
        top = min(lab['NPa'][1], lab['NPb'][1])
        for k, (x, y) in enumerate(pc['uv']):
            s = (x - cx) * u
            t = arc_to_t(ts, arc, s) + (0 if key == 'front' else math.pi)
            pos[pc['offset'] + k] = (o['wrap_a'] * math.sin(t), -o['wrap_b'] * math.cos(t) + o['wrap_yc'],
                                     o['top_z'] - (y - top) * u)
    alpha = math.radians(o['arm_angle'])
    for key, side in (('sleeveL', 1), ('sleeveR', -1)):
        pc = P[key]
        E = pc['edges']
        tip_i = E['cap_a'][-1] - pc['offset']
        tx, ty = pc['uv'][tip_i]
        xs = [p[0] for p in pc['uv']]
        R = (max(xs) - min(xs)) * u / (2 * math.pi)
        d = (side * math.sin(alpha), 0.0, -math.cos(alpha))
        nt = (side * math.cos(alpha), 0.0, math.sin(alpha))
        J = (side * o['joint_x'], 0.0, o['joint_z'])
        for k, (x, y) in enumerate(pc['uv']):
            phi = (x - tx) * u / R
            along = o['sleeve_s0'] + (y - ty) * u
            p = [J[c] + d[c] * along + R * math.cos(phi) * nt[c] for c in range(3)]
            p[1] += side * R * math.sin(phi)
            # Lo que quedaría dentro del torso se aplasta contra su costado.
            hw = torso_halfwidth(p[2]) + o['clear']
            if side * p[0] < hw:
                p[0] = side * hw
            pos[pc['offset'] + k] = tuple(p)
    return pos


def simulate(data, o):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    body = build_body(scene, o)
    u = data['unit_m']
    verts = initial_positions(data, o)
    faces, rest = [], []
    for pc in data['pieces']:
        off = pc['offset']
        faces += [(a + off, b + off, c + off) for a, b, c in pc['tris']]
        rest += [(x * u, -y * u, 0.0) for x, y in pc['uv']]
    sew = [tuple(p) for s in data['seams'] for p in s['pairs']]
    mesh = bpy.data.meshes.new('camiseta')
    mesh.from_pydata(verts, sew, faces)
    mesh.update()
    # Coordenadas del molde como UV (el diseño cae justo donde se sublima).
    # La textura (textura.py) es la mesa de trabajo del SVG: viewBox.
    vx, vy, W, H = data['viewbox']
    uvl = mesh.uv_layers.new(name='molde')
    flat = [p for pc in data['pieces'] for p in pc['uv']]
    for loop in mesh.loops:
        x, y = flat[loop.vertex_index]
        uvl.data[loop.index].uv = ((x - vx) / W, 1 - (y - vy) / H)
    obj = bpy.data.objects.new('camiseta', mesh)
    scene.collection.objects.link(obj)
    obj.shape_key_add(name='Basis')
    sk = obj.shape_key_add(name='molde')
    sk.value = 0.0
    for i, co in enumerate(rest):
        sk.data[i].co = co

    # La copa de la manga mide más que la sisa (la tela de punto lo absorbe):
    # junto a la costura se encoge lo que sobra, así no se frunce.
    if o['cap_ease'] == 'auto':
        # Lo que la copa mide de más que la sisa, medido en el molde.
        flat = [p for pc in data['pieces'] for p in pc['uv']]
        def plen(ids):
            return sum(math.dist(flat[ids[k]], flat[ids[k + 1]]) for k in range(len(ids) - 1))
        arm = [s for s in data['seams'] if s['kind'] == 'armhole']
        cap = sum(plen([b for a, b in s['pairs']]) for s in arm)
        hole = sum(plen([a for a, b in s['pairs']]) for s in arm)
        o['cap_ease'] = max(0.0, 1 - hole / cap)
        print(f"embebido de la copa: {o['cap_ease']:.1%}")
    if o['cap_ease']:
        g = obj.vertex_groups.new(name='copa')
        for pc in data['pieces']:
            if not pc['key'].startswith('sleeve'):
                continue
            off = pc['offset']
            cap = [pc['uv'][i - off] for i in pc['edges']['cap_a'] + pc['edges']['cap_b']]
            R = o['cap_ease_cm'] / 2.54 * 72
            for k, (x, y) in enumerate(pc['uv']):
                d = min(math.hypot(x - cx, y - cy) for cx, cy in cap)
                w = max(0.0, 1 - d / R)
                if w > 0:
                    g.add([off + k], w, 'REPLACE')

    cloth = obj.modifiers.new('tela', 'CLOTH')
    s = cloth.settings
    s.quality = o['quality']
    s.mass = o['mass']
    s.air_damping = o['air']
    s.tension_stiffness = o['tension']
    s.compression_stiffness = o['compression']
    s.shear_stiffness = o['shear']
    s.bending_stiffness = o['bending']
    s.tension_damping = s.compression_damping = s.shear_damping = 5.0
    s.bending_damping = 0.5
    s.rest_shape_key = sk
    s.use_sewing_springs = True
    if o['cap_ease']:
        s.vertex_group_shrink = 'copa'
        s.shrink_min = 0.0
        s.shrink_max = o['cap_ease']
    s.sewing_force_max = o['sewing']
    c = cloth.collision_settings
    c.use_collision = True
    c.distance_min = o['col_dist']
    c.collision_quality = o['col_quality']
    c.use_self_collision = o['self']
    c.self_distance_min = o['col_dist']
    c.impulse_clamp = o['clamp']
    frames = o['frames']
    cloth.point_cache.frame_start = 1
    cloth.point_cache.frame_end = frames
    scene.frame_start, scene.frame_end = 1, frames
    # Primero se cierran las costuras sin peso; después cae sobre el cuerpo.
    ew = s.effector_weights
    ew.gravity = 0.0
    ew.keyframe_insert('gravity', frame=1)
    ew.keyframe_insert('gravity', frame=o['gravity_from'])
    ew.gravity = 1.0
    ew.keyframe_insert('gravity', frame=o['gravity_from'] + 10)

    t0 = time.time()
    for f in range(1, frames + 1):
        scene.frame_set(f)
        if f % 10 == 0:
            print(f'cuadro {f}/{frames} {time.time() - t0:.0f}s', flush=True)
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    m = ev.to_mesh()
    final = [tuple(v.co) for v in m.vertices]
    ev.to_mesh_clear()
    print(f'listo en {time.time() - t0:.0f}s', flush=True)
    return final, obj, body


DEFAULTS = {
    'body_sx': 1.2, 'body_sy': 1.1, 'arm_s': 1.15, 'arm_angle': 42.0,
    'joint_x': 0.18, 'joint_z': -0.094, 'body_thick': 0.004, 'body_friction': 2.0,
    'wrap_a': 0.21, 'wrap_b': 0.155, 'wrap_yc': 0.0, 'top_z': 0.012,
    'sleeve_s0': -0.03, 'clear': 0.012,
    'quality': 8, 'mass': 0.02, 'air': 3.0, 'tension': 40.0, 'compression': 40.0,
    'shear': 20.0, 'bending': 0.6, 'sewing': 10.0, 'col_dist': 0.003, 'col_quality': 3,
    'self': False, 'cap_ease': 'auto', 'cap_ease_cm': 5.0, 'clamp': 0.05, 'frames': 150, 'gravity_from': 40,
}

if __name__ == '__main__':
    src, dst, blend = sys.argv[1:4]
    o = {**DEFAULTS, **(json.loads(sys.argv[4]) if len(sys.argv) > 4 else {})}
    data = json.load(open(src))
    final, obj, body = simulate(data, o)
    json.dump({'position': [round(c, 6) for p in final for c in p], 'opts': o}, open(dst, 'w'))
    # Archivo de Blender con la forma ya fija (sin la simulación).
    obj.modifiers.remove(obj.modifiers['tela'])
    obj.shape_key_clear()
    for v, p in zip(obj.data.vertices, final):
        v.co = p
    for b in body:
        b.hide_render = True
    bpy.ops.wm.save_as_mainfile(filepath=blend)
