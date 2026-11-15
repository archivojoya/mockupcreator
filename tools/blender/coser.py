"""Cose las piezas del molde (piezas.json) sobre un cuerpo invisible con el
simulador de tela de Blender y guarda la forma final.

    python coser.py piezas.json salida.json salida.blend [opciones JSON]

Coordenadas de Blender: z arriba, el frente mira a -y. z = 0 es el punto del
cuello de la camiseta; el cuerpo es la horma de cuerpo.py, hecha a la medida
de la prenda.
"""
import json
import math
import os
import sys
import time

import bpy

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cuerpo  # noqa: E402


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


def garment_measures(data):
    """Medidas de la prenda (en metros) que definen la horma."""
    u = data['unit_m']
    L = {pc['key']: pc['labels'] for pc in data['pieces']}['front']
    top = (L['NPa'][1] + L['NPb'][1]) / 2
    return {
        'np_x': abs(L['NPb'][0] - L['NPa'][0]) / 2 * u,
        'sp_x': abs(L['SPb'][0] - L['SPa'][0]) / 2 * u,
        'sp_z': -((L['SPa'][1] + L['SPb'][1]) / 2 - top) * u,
        'chest': 2 * abs(L['UAb'][0] - L['UAa'][0]) * u,
        'hem': 2 * abs(L['HMb'][0] - L['HMa'][0]) * u,
        'length': ((L['HMa'][1] + L['HMb'][1]) / 2 - top) * u,
    }


def build_body(scene, data, o):
    """La horma (cuerpo.py), como sólido de choque. Arranca fina, así las
    costuras se cierran con lugar de sobra en la axila y el hombro, y se
    infla despacio hasta su medida: llena la prenda desde adentro, sin
    arrastrar la tela (bajar los brazos ya vestidos torcía las mangas)."""
    form = cuerpo.Cuerpo({**garment_measures(data), **o['body']})
    V, F, thin = form.mesh()
    if form.flipped:
        print(f'ojo: {form.flipped} caras del cuerpo fino quedaron al revés', flush=True)
    me = bpy.data.meshes.new('cuerpo')
    me.from_pydata(V.tolist(), [], F.tolist())
    me.update()
    ob = bpy.data.objects.new('cuerpo', me)
    scene.collection.objects.link(ob)
    ob.shape_key_add(name='Basis')
    sk = ob.shape_key_add(name='fino')
    for i, co in enumerate(thin):
        sk.data[i].co = co
    f0, f1 = o['inflate']
    sk.value = 1.0
    sk.keyframe_insert('value', frame=f0)
    sk.value = 0.0
    sk.keyframe_insert('value', frame=f1)
    ob.modifiers.new('col', 'COLLISION')
    ob.collision.thickness_outer = o['body_thick']
    ob.collision.thickness_inner = 0.02
    ob.collision.cloth_friction = o['body_friction']
    ob.collision.damping = 0.5
    return form, [ob]


def initial_positions(data, form, o):
    u = data['unit_m']
    P = {pc['key']: pc for pc in data['pieces']}
    pos = [None] * sum(len(pc['uv']) for pc in data['pieces'])
    # Frente y espalda. De la axila para abajo, enrollados en un óvalo del
    # contorno de la prenda. De la axila para arriba el óvalo se abre hasta
    # ser casi un plano y se acerca a la línea del hombro: las dos piezas
    # quedan como dos hojas inclinadas, una delante y otra detrás de los
    # hombros, casi tocándose arriba. Así el borde de cada sisa arranca de su
    # lado del hombro (enrollado, el de la espalda caía por delante de la
    # bola del hombro y al coserse hacía un nudo) y los hombros se cierran sin
    # levantar la prenda (derechas, la tela subía 12 cm).
    wa = form.o['a_chest'] + o['wrap_out']
    wb = cuerpo.depth_for(wa, 2.0, form.o['chest'])
    lean, s1, s2 = math.radians(o['lean']), o['lean_to'], o['lean_to'] + 0.10
    prof_s = np.linspace(0, 1.2, 1201)
    ang = lean * np.clip((s2 - prof_s) / (s2 - s1), 0, 1)
    ang = ang * ang * (3 - 2 * ang / lean) / lean if lean else ang  # baja suave a 0
    dz = np.r_[0, np.cumsum(np.cos(ang[:-1]) * np.diff(prof_s))]
    dy = np.r_[0, np.cumsum(np.sin(ang[:-1]) * np.diff(prof_s))]
    y_top = wb - dy[-1]  # medio fondo arriba de todo
    tables = {}

    def wrap(s, half_width, half_depth, sign):
        """Punto del óvalo a la distancia s del centro (sign: -1 frente, +1
        espalda). Lo que no entra en el cuarto de vuelta sigue derecho hacia
        el costado, sin dar la vuelta al otro lado."""
        key = (round(half_width, 3), round(half_depth, 3))
        if key not in tables:
            ts, arc = ellipse_table(key[0], key[1], 1000)
            tables[key] = (ts, arc, arc[len(arc) // 2])
        ts, arc, quarter = tables[key]
        if abs(s) > quarter:
            return math.copysign(key[0] + abs(s) - quarter, s), 0.0
        t = arc_to_t(ts, arc, s)
        return key[0] * math.sin(t), sign * key[1] * math.cos(t)

    for key in ('front', 'back'):
        pc = P[key]
        lab = pc['labels']
        cx = (lab['NPa'][0] + lab['NPb'][0]) / 2
        top = min(lab['NPa'][1], lab['NPb'][1])
        for k, (x, y) in enumerate(pc['uv']):
            sv = max(0.0, (y - top) * u)
            hd = y_top + float(np.interp(sv, prof_s, dy))
            f = min(1.0, sv / o['flat_to'])
            hw = wa + (o['flat_top'] - wa) * (1 - f * f * (3 - 2 * f))
            if key == 'front':
                px, py = wrap((x - cx) * u, hw, hd, -1)
            else:  # la espalda se mira desde atrás: su derecha es -x
                px, py = wrap(-(x - cx) * u, hw, hd, 1)
            pos[pc['offset'] + k] = (px, py + o['wrap_yc'], o['top_z'] - float(np.interp(sv, prof_s, dz)))
    # Mangas: un tubo alrededor de cada brazo, con la punta de la copa arriba.
    for key, side in (('sleeveL', 1), ('sleeveR', -1)):
        pc = P[key]
        tip_i = pc['edges']['cap_a'][-1] - pc['offset']
        tx, ty = pc['uv'][tip_i]
        xs = [p[0] for p in pc['uv']]
        R = (max(xs) - min(xs)) * u / (2 * math.pi)
        J, d = form.arm_axis(side)
        nt = np.array([side * math.cos(math.radians(form.o['arm_angle'])), 0.0, math.sin(math.radians(form.o['arm_angle']))])
        nt -= d * nt.dot(d)
        nt /= np.linalg.norm(nt)
        bn = np.array([0.0, 1.0, 0.0])
        bn -= d * bn.dot(d) + nt * bn.dot(nt)
        bn /= np.linalg.norm(bn)
        for k, (x, y) in enumerate(pc['uv']):
            phi = (x - tx) * u / R
            along = o['sleeve_s0'] + (y - ty) * u
            p = J + d * along + nt * (R * math.cos(phi)) + bn * (side * R * math.sin(phi))
            pos[pc['offset'] + k] = tuple(p)
    # Nada arranca dentro del cuerpo fino (ni pegado a él).
    level = -form.o['skin'] - form.o['thin'] + o['clear']
    return [tuple(p) for p in form.push_out(np.array(pos), level)]


def simulate(data, o):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    form, body = build_body(scene, data, o)
    u = data['unit_m']
    verts = initial_positions(data, form, o)
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

    # La copa de la manga y la sisa no miden lo mismo (la tela de punto lo
    # absorbe): del lado que mide más, junto a la costura, se encoge lo que
    # sobra, así no se frunce.
    flat = [p for pc in data['pieces'] for p in pc['uv']]

    def plen(ids):
        return sum(math.dist(flat[ids[k]], flat[ids[k + 1]]) for k in range(len(ids) - 1))
    arm = [s for s in data['seams'] if s['kind'] == 'armhole']
    cap = sum(plen([b for a, b in s['pairs']]) for s in arm)
    hole = sum(plen([a for a, b in s['pairs']]) for s in arm)
    if o['cap_ease'] == 'auto':
        o['cap_ease'] = 1 - min(hole, cap) / max(hole, cap)
        print(f"la {'copa' if cap > hole else 'sisa'} mide {o['cap_ease']:.1%} más", flush=True)
    if o['cap_ease']:
        g = obj.vertex_groups.new(name='embebido')
        R = o['cap_ease_cm'] / 2.54 * 72
        for pc in data['pieces']:
            off = pc['offset']
            sleeve = pc['key'].startswith('sleeve')
            if sleeve != (cap > hole):
                continue
            names = ('cap_a', 'cap_b') if sleeve else ('arm_a', 'arm_b')
            for name in names:
                edge = np.array([pc['uv'][i - off] for i in pc['edges'][name]])
                uv = np.array(pc['uv'])
                d = np.min(np.linalg.norm(uv[:, None, :] - edge[None, :, :], axis=2), axis=1)
                for k in np.where(d < R)[0]:
                    g.add([off + int(k)], float(1 - d[k] / R), 'REPLACE')

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
    # Las medidas de reposo son las del molde plano. La opción directa
    # (rest_shape_key) no hace efecto en Blender 5.2: la tela se quedaba con
    # las medidas de la posición de arranque, y cualquier acomodo que no fuera
    # exacto quedaba cosido en la prenda. Con la base dinámica el reposo sale
    # de la malla base, que desde el cuadro 2 es el molde plano.
    s.use_dynamic_mesh = True
    sk.value = 0.0
    sk.keyframe_insert('value', frame=1)
    sk.value = 1.0
    sk.keyframe_insert('value', frame=2)
    s.use_sewing_springs = True
    if o['cap_ease']:
        s.vertex_group_shrink = 'embebido'
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
    snaps = {}
    for f in range(1, frames + 1):
        scene.frame_set(f)
        if f % 10 == 0:
            print(f'cuadro {f}/{frames} {time.time() - t0:.0f}s', flush=True)
        if f in o['snap']:
            # Para revisar: la tela en ese cuadro.
            m = obj.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
            snaps[f] = [round(c, 5) for v in m.vertices for c in v.co]
    o['snaps'] = snaps
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    m = ev.to_mesh()
    final = [tuple(v.co) for v in m.vertices]
    ev.to_mesh_clear()
    print(f'listo en {time.time() - t0:.0f}s', flush=True)
    return final, obj, body


DEFAULTS = {
    'body': {},  # cambios a la horma (ver cuerpo.DEFAULTS)
    'snap': [],  # cuadros a guardar para revisar
    'inflate': [90, 150], 'body_thick': 0.004, 'body_friction': 0.3,
    'wrap_out': 0.02, 'wrap_yc': 0.005, 'top_z': 0.015, 'lean': 30.0, 'lean_to': 0.16, 'flat_top': 0.40, 'flat_to': 0.28, 'sleeve_s0': -0.03, 'clear': 0.012,
    'quality': 8, 'mass': 0.02, 'air': 3.0, 'tension': 40.0, 'compression': 40.0,
    'shear': 20.0, 'bending': 0.6, 'sewing': 10.0, 'col_dist': 0.003, 'col_quality': 3,
    'self': False, 'cap_ease': 'auto', 'cap_ease_cm': 5.0, 'clamp': 0.05, 'frames': 200, 'gravity_from': 40,
}

if __name__ == '__main__':
    src, dst, blend = sys.argv[1:4]
    o = {**DEFAULTS, **(json.loads(sys.argv[4]) if len(sys.argv) > 4 else {})}
    data = json.load(open(src))
    final, obj, body = simulate(data, o)
    snaps = o.pop('snaps', {})
    json.dump({'position': [round(c, 6) for p in final for c in p], 'opts': o, **{f'f{k}': v for k, v in snaps.items()}}, open(dst, 'w'))
    # Archivo de Blender con la forma ya fija (sin la simulación).
    obj.modifiers.remove(obj.modifiers['tela'])
    obj.shape_key_clear()
    for v, p in zip(obj.data.vertices, final):
        v.co = p
    for b in body:
        b.hide_render = True
    bpy.ops.wm.save_as_mainfile(filepath=blend)
