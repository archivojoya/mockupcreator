"""Lámina de la camiseta cosida: suaviza, une las costuras, le da espesor,
tela y luz de estudio, y renderiza vistas con fondo transparente.

    python render.py camiseta.blend piezas.json diseno.png salida_prefijo [opciones JSON]
"""
import json
import math
import sys

import bpy
import bmesh
import numpy as np
from mathutils import Vector


def weld_seams(obj, data):
    parent = {}

    def find(a):
        while parent.get(a, a) != a:
            a = parent[a]
        return a

    for s in data['seams']:
        for i, j in s['pairs']:
            ri, rj = find(i), find(j)
            if ri != rj:
                parent[max(ri, rj)] = min(ri, rj)
    groups = {}
    for v in list(parent):
        groups.setdefault(find(v), set()).update((v, find(v)))
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    orig = bm.verts.layers.int.new('orig')
    for v in bm.verts:
        v[orig] = v.index
    tm = {}
    for rep, members in groups.items():
        co = sum((bm.verts[m].co for m in members), Vector()) / len(members)
        bm.verts[rep].co = co
        for m in members:
            if m != rep:
                tm[bm.verts[m]] = bm.verts[rep]
    bmesh.ops.weld_verts(bm, targetmap=tm)
    loose = [e for e in bm.edges if not e.link_faces]
    bmesh.ops.delete(bm, geom=loose, context='EDGES')
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def taubin(obj, iters, lam=0.5, mu=-0.53, max_move=0.004):
    """Suavizado que no encoge: borra ondas chicas sin tocar la caída."""
    me = obj.data
    n = len(me.vertices)
    P0 = np.array([v.co for v in me.vertices])
    E = np.array([e.vertices for e in me.edges])
    deg = np.bincount(E.ravel(), minlength=n).astype(float)
    # Los bordes abiertos (cuello, ruedo, puños) se suavizan sólo a lo largo de sí mismos.
    bm = bmesh.new()
    bm.from_mesh(me)
    border = np.array([v.is_boundary for v in bm.verts])
    bedges = np.array([[e.verts[0].index, e.verts[1].index] for e in bm.edges if e.is_boundary])
    bm.free()
    P = P0.copy()

    def step(P, f):
        S = np.zeros_like(P)
        np.add.at(S, E[:, 0], P[E[:, 1]])
        np.add.at(S, E[:, 1], P[E[:, 0]])
        L = S / np.maximum(deg, 1)[:, None] - P
        Sb = np.zeros_like(P)
        db = np.bincount(bedges.ravel(), minlength=n).astype(float)
        np.add.at(Sb, bedges[:, 0], P[bedges[:, 1]])
        np.add.at(Sb, bedges[:, 1], P[bedges[:, 0]])
        Lb = Sb / np.maximum(db, 1)[:, None] - P
        L[border] = Lb[border]
        return P + f * L

    for _ in range(iters):
        P = step(step(P, lam), mu)
    d = P - P0
    m = np.linalg.norm(d, axis=1)
    k = np.minimum(1, max_move / np.maximum(m, 1e-9))
    P = P0 + d * k[:, None]
    for v, p in zip(me.vertices, P):
        v.co = p
    me.update()


def srgb(hexcol):
    c = [int(hexcol[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c) + (1.0,)


def neckband(obj, data, o):
    """Tira del cuello: una banda parada que sale del borde del escote, con
    el borde de arriba apenas más corto (el rib tira hacia el cuello)."""
    me = obj.data
    keys = {pc['key']: pc for pc in data['pieces']}
    neck = set(keys['front']['edges']['neck'] + keys['back']['edges']['neck'])
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    lay = bm.verts.layers.int['orig']
    start = next(v for v in bm.verts if v[lay] in neck and v.is_boundary)
    loop, prev, cur = [start], None, start
    while True:
        nxt = [e.other_vert(cur) for e in cur.link_edges if e.is_boundary and e.other_vert(cur) is not prev]
        cur, prev = nxt[0], cur
        if cur is start:
            break
        loop.append(cur)
    bm.normal_update()
    P = np.array([v.co for v in loop])
    n = len(P)
    C = P.mean(0)
    up = np.array([0, 0, 1.0])
    rings_dir, rings_nrm = [], []
    for i, v in enumerate(loop):
        inner = [np.array(e.other_vert(v).co) for e in v.link_edges if not e.is_boundary]
        cont = P[i] - np.mean(inner, axis=0)
        t = P[(i + 1) % n] - P[i - 1]
        t /= np.linalg.norm(t)
        cont -= t * cont.dot(t)
        cont /= np.linalg.norm(cont)
        inward = np.array([C[0] - P[i][0], C[1] - P[i][1], 0.0])
        inward /= np.linalg.norm(inward) + 1e-9
        d = cont * (1 - o['band_up'] - o['band_in']) + up * o['band_up'] + inward * o['band_in']
        d -= t * d.dot(t)
        rings_dir.append(d / np.linalg.norm(d))
        rings_nrm.append(np.array(v.normal))
    bm.free()
    # Suavizar las direcciones a lo largo del borde.
    D = np.array(rings_dir)
    for _ in range(6):
        D = (np.roll(D, 1, 0) + 2 * D + np.roll(D, -1, 0)) / 4
    D /= np.linalg.norm(D, axis=1)[:, None]
    Nn = np.array(rings_nrm)
    J, H = 6, o['band_h']
    verts, faces, uvs = [], [], []
    seglen = np.linalg.norm(np.roll(P, -1, 0) - P, axis=1)
    s_acc = np.r_[0, np.cumsum(seglen)[:-1]]
    for j in range(J + 1):
        f = j / J
        h = -o['band_overlap'] + (H + o['band_overlap']) * f
        ring = P + D * h + Nn * o['band_out']
        sh = 1 - o['band_tight'] * f
        ring[:, :2] = C[:2] + (ring[:, :2] - C[:2]) * sh
        verts.extend(ring.tolist())
    for j in range(J):
        for i in range(n):
            a, b = j * n + i, j * n + (i + 1) % n
            faces.append((a, b, b + n, a + n))
    m = bpy.data.meshes.new('cuello')
    m.from_pydata(verts, [], faces)
    uvl = m.uv_layers.new(name='rib')
    for poly in m.polygons:
        poly.use_smooth = True
        for li in poly.loop_indices:
            vi = m.loops[li].vertex_index
            j, i = divmod(vi, n)
            uvl.data[li].uv = (s_acc[i], j / J)
    band = bpy.data.objects.new('cuello', m)
    bpy.context.scene.collection.objects.link(band)
    mat = bpy.data.materials.new('rib')
    mat.use_nodes = True
    N, L = mat.node_tree.nodes, mat.node_tree.links
    b = N['Principled BSDF']
    b.inputs['Base Color'].default_value = srgb(o['collar_color'])
    b.inputs['Roughness'].default_value = 0.7
    b.inputs['Sheen Weight'].default_value = 0.4
    uv = N.new('ShaderNodeUVMap')
    uv.uv_map = 'rib'
    wave = N.new('ShaderNodeTexWave')
    wave.inputs['Scale'].default_value = 40.0  # costillas del rib, ~6 por cm
    L.new(uv.outputs['UV'], wave.inputs['Vector'])
    bump = N.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.25
    L.new(wave.outputs['Fac'], bump.inputs['Height'])
    L.new(bump.outputs['Normal'], b.inputs['Normal'])
    m.materials.append(mat)
    so = band.modifiers.new('espesor', 'SOLIDIFY')
    so.thickness = o['band_thick']
    so.offset = 0
    so.use_even_offset = True
    sd = band.modifiers.new('sub', 'SUBSURF')
    sd.levels = 0
    sd.render_levels = 2
    return band


def fabric_material(name, tex, inside=False, plain=None, stitch=None, knit=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    N, L = nt.nodes, nt.links
    bsdf = N['Principled BSDF']
    uv = N.new('ShaderNodeUVMap')
    uv.uv_map = 'molde'
    if plain:
        # Un solo color liso (sin el diseño del molde).
        rgb = N.new('ShaderNodeRGB')
        rgb.outputs[0].default_value = srgb(plain)
        col = rgb.outputs[0]
    else:
        img = N.new('ShaderNodeTexImage')
        img.image = bpy.data.images.load(tex, check_existing=True)
        img.interpolation = 'Cubic'
        L.new(uv.outputs['UV'], img.inputs['Vector'])
        col = img.outputs['Color']
    if inside:
        # El revés de la tela sublimada: el diseño más apagado.
        mix = N.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.inputs['Factor'].default_value = 0.35
        mix.inputs['B'].default_value = (0.85, 0.85, 0.85, 1)
        L.new(col, mix.inputs['A'])
        col = mix.outputs['Result']
    L.new(col, bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.62
    bsdf.inputs['Specular IOR Level'].default_value = 0.35
    bsdf.inputs['Sheen Weight'].default_value = 0.35
    bsdf.inputs['Sheen Roughness'].default_value = 0.35
    # Un granulado muy suave de la tela (no el tejido, que a esta distancia hace moiré).
    noise = N.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 900.0
    noise.inputs['Detail'].default_value = 2.0
    bump = N.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.08
    bump.inputs['Distance'].default_value = 0.0004
    L.new(noise.outputs['Fac'], bump.inputs['Height'])
    normal = bump.outputs['Normal']
    if knit:
        # Trama de malla deportiva: una grilla fina de puntos en relieve, en
        # centímetros del molde (la UV va de 0 a 1 sobre toda la mesa).
        mp = N.new('ShaderNodeMapping')
        mp.inputs['Scale'].default_value = (knit['w_cm'], knit['h_cm'], 1.0)
        L.new(uv.outputs['UV'], mp.inputs['Vector'])
        sep = N.new('ShaderNodeSeparateXYZ')
        L.new(mp.outputs['Vector'], sep.inputs['Vector'])
        waves = []
        for axis in ('X', 'Y'):
            m = N.new('ShaderNodeMath')
            m.operation = 'MULTIPLY'
            m.inputs[1].default_value = 2 * math.pi / knit['period_cm']
            L.new(sep.outputs[axis], m.inputs[0])
            sn = N.new('ShaderNodeMath')
            sn.operation = 'SINE'
            L.new(m.outputs[0], sn.inputs[0])
            waves.append(sn)
        prod = N.new('ShaderNodeMath')
        prod.operation = 'MULTIPLY'
        L.new(waves[0].outputs[0], prod.inputs[0])
        L.new(waves[1].outputs[0], prod.inputs[1])
        kb = N.new('ShaderNodeBump')
        kb.inputs['Strength'].default_value = knit['strength']
        kb.inputs['Distance'].default_value = 0.0003
        L.new(prod.outputs[0], kb.inputs['Height'])
        L.new(normal, kb.inputs['Normal'])
        normal = kb.outputs['Normal']
    if stitch and not inside:
        # Costuras y pespuntes (costuras.py), en el plano del molde.
        st = N.new('ShaderNodeTexImage')
        st.image = bpy.data.images.load(stitch, check_existing=True)
        st.image.colorspace_settings.name = 'Non-Color'
        L.new(uv.outputs['UV'], st.inputs['Vector'])
        b2 = N.new('ShaderNodeBump')
        b2.inputs['Strength'].default_value = 1.0
        b2.inputs['Distance'].default_value = 0.0012
        L.new(st.outputs['Color'], b2.inputs['Height'])
        L.new(normal, b2.inputs['Normal'])
        normal = b2.outputs['Normal']
    L.new(normal, bsdf.inputs['Normal'])
    return mat


def aim(ob, target):
    d = Vector(target) - ob.location
    ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def area(name, loc, target, size, energy, size_y=None, parent=None):
    lt = bpy.data.lights.new(name, 'AREA')
    lt.energy = energy
    if size_y:
        lt.shape = 'RECTANGLE'
        lt.size, lt.size_y = size, size_y
    else:
        lt.size = size
    ob = bpy.data.objects.new(name, lt)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    aim(ob, target)
    if parent:
        ob.parent = parent
        ob.matrix_parent_inverse = parent.matrix_world.inverted()
    return ob


def main(blend, piezas, tex, prefix, o):
    bpy.ops.wm.open_mainfile(filepath=blend)
    sc = bpy.context.scene
    obj = bpy.data.objects['camiseta']
    data = json.load(open(piezas))
    weld_seams(obj, data)
    if o['taubin']:
        taubin(obj, o['taubin'], max_move=o['taubin_max'])
    for p in obj.data.polygons:
        p.use_smooth = True
    if o['collar_color'] or o['plain']:
        neckband(obj, data, {**o, 'collar_color': o['plain'] or o['collar_color']})
    knit = None
    if o['knit']:
        vx, vy, vw, vh = data['viewbox']
        knit = {'w_cm': vw * 2.54 / 72, 'h_cm': vh * 2.54 / 72, 'period_cm': o['knit'], 'strength': o['knit_strength']}
    obj.data.materials.append(fabric_material('tela', tex, plain=o['plain'], stitch=o['stitch'], knit=knit))
    obj.data.materials.append(fabric_material('reves', tex, inside=True, plain=o['plain'], knit=knit))
    so = obj.modifiers.new('espesor', 'SOLIDIFY')
    so.thickness = o['thick']
    so.offset = -1
    so.use_even_offset = True
    so.use_rim = True
    so.material_offset = 1
    so.material_offset_rim = 0
    sd = obj.modifiers.new('sub', 'SUBSURF')
    sd.levels = 0
    sd.render_levels = o['subdiv']

    # Centro y alto de la prenda.
    co = np.array([v.co for v in obj.data.vertices])
    lo, hi = co.min(0), co.max(0)
    c = (lo + hi) / 2
    target = (0.0, 0.0, c[2])

    # Las luces cuelgan de un eje que gira con la cámara: cada vista se
    # ilumina igual (la espalda como el frente).
    rig = bpy.data.objects.new('luces', None)
    sc.collection.objects.link(rig)
    rig.location = target
    bpy.context.view_layer.update()
    area('clave', (-1.7, -2.3, c[2] + 1.0), target, 1.4, o['key'], parent=rig)
    area('relleno', (2.4, -1.7, c[2] + 0.2), target, 2.2, o['fill'], parent=rig)
    area('contra_izq', (-1.8, 1.8, c[2] + 0.4), target, 0.5, o['rim'], 1.6, parent=rig)
    area('contra_der', (1.8, 1.8, c[2] + 0.4), target, 0.5, o['rim'], 1.6, parent=rig)
    area('arriba', (0.0, -0.6, c[2] + 2.0), target, 1.5, o['top'], parent=rig)
    w = bpy.data.worlds.new('estudio')
    sc.world = w
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (1, 1, 1, 1)
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = o['world']

    cam_data = bpy.data.cameras.new('cam')
    cam_data.lens = o['lens']
    cam = bpy.data.objects.new('cam', cam_data)
    sc.collection.objects.link(cam)
    sc.camera = cam
    height = (hi[2] - lo[2]) * o['margin']
    width = (hi[0] - lo[0]) * o['margin']
    R = sc.render
    R.resolution_x, R.resolution_y = o['res']
    aspect = R.resolution_x / R.resolution_y
    frame_h = max(height, width / aspect)
    dist = frame_h * o['lens'] / 36.0 * (1 if aspect <= 1 else aspect)

    R.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = o['samples']
    sc.cycles.adaptive_threshold = 0.02
    sc.cycles.use_denoising = True
    R.film_transparent = True
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.view_settings.exposure = o['exposure']
    R.image_settings.file_format = 'PNG'
    R.image_settings.color_mode = 'RGBA'

    views = {'frente': (0, -1), 'espalda': (0, 1), 'tres_cuartos': (-0.6, -0.8)}
    for name in o['views']:
        dx, dy = views[name]
        cam.location = (dx * dist, dy * dist, c[2] + dist * math.tan(math.radians(o['elev'])))
        aim(cam, target)
        rig.rotation_euler = (0.0, 0.0, math.atan2(dx, -dy))
        R.filepath = f'{prefix}_{name}.png'
        bpy.ops.render.render(write_still=True)
        print('listo', R.filepath, flush=True)
    if o.get('save'):
        # La textura va adentro del archivo, así abre en cualquier compu.
        bpy.ops.file.pack_all()
        bpy.ops.wm.save_as_mainfile(filepath=o['save'])


DEFAULTS = {
    'taubin': 80, 'taubin_max': 0.009, 'thick': 0.0012, 'subdiv': 1, 'key': 140.0, 'fill': 35.0, 'rim': 45.0,
    'top': 20.0, 'world': 0.12, 'plain': None, 'stitch': None, 'knit': 0.14, 'knit_strength': 0.35, 'collar_color': '#1e007c', 'band_h': 0.017, 'band_up': 0.3, 'band_in': 0.45,
    'band_overlap': 0.004, 'band_out': 0.0015, 'band_tight': 0.0, 'band_thick': 0.0025, 'lens': 85.0, 'margin': 1.12, 'res': [1200, 1500],
    'samples': 64, 'exposure': -0.5, 'elev': 6.0, 'views': ['frente', 'espalda'],
}

if __name__ == '__main__':
    blend, piezas, tex, prefix = sys.argv[1:5]
    o = {**DEFAULTS, **(json.loads(sys.argv[5]) if len(sys.argv) > 5 else {})}
    main(blend, piezas, tex, prefix, o)
