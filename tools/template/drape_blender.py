"""Paso 2 de la plantilla: simula la caída de la camiseta con el simulador
de tela de Blender (sin interfaz) y guarda la forma final.

    python drape_blender.py entrada.json salida.json [cuadros] [opciones JSON]

Necesita el módulo bpy (pip install bpy). La entrada la arma
export-initial.mjs: piezas con su forma 3D inicial y su molde plano, pares de
costura, fijaciones y la percha. El molde plano es la forma en reposo de la
tela (largos y curvatura), así la tela cae como cae su molde de verdad.

Con {"body": true} la camiseta no cuelga de la percha sino que queda
sostenida por un maniquí invisible (body.py).
"""
import json
import math
import os
import sys
import time

import bpy
import bmesh


def to_b(x, y, z):
    # three.js (y arriba, z hacia la cámara) -> Blender (z arriba, y hacia atrás)
    return (x, -z, y)


def from_b(x, y, z):
    return (x, z, -y)


def main(src, dst, frames, opts):
    data = json.load(open(src))
    if not opts.get("body"):
        start = [x for pc in data["pieces"] for x in pc["position"]]
        pos, snaps = simulate(data, start, data["sew"], frames, opts)
    else:
        # Camiseta sostenida por un maniquí invisible, armada como en un
        # programa de confección: cada pieza arranca curvada alrededor del
        # cuerpo y las costuras se cierran solas, sin gravedad.
        import body as maniqui

        joints = maniqui.joints(sleeve_axes(data), opts)
        wrap = wrapped_positions(data, opts, joints)
        start = [x for pc in data["pieces"] for x in wrap[pc["key"]]]
        # Etapa 1: hombros y costados (las mangas esperan sueltas).
        n1 = opts.get("stage1_frames", 30)
        first = [e for e in data["sew"] if seam_kind(data, *e) in ("shoulder", "side")]
        pos1, _ = simulate(data, start, first, n1, {**opts, "snapshots": []})
        # Etapa 2: cada manga arranca pegada a su sisa ya armada y se cose
        # todo mientras la tela se asienta sobre el maniquí.
        start = attach_sleeves(data, pos1, wrap, opts)
        pos, snaps = simulate(data, start, data["sew"], frames, opts)
    out = {"position": pos, "snapshots": {str(k): v for k, v in snaps.items()}, "body": bool(opts.get("body"))}
    json.dump(out, open(dst, "w"))


def simulate(data, start, sew, frames, opts):
    """Una simulación: piezas en `start` (posiciones de three.js, todas
    seguidas), costuras `sew`; devuelve la forma final y las instantáneas."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    use_body = opts.get("body", False)
    if use_body:
        import body as maniqui

        maniqui.build_body(scene, sleeve_axes(data), opts)

    verts, faces, rest = [], [], []
    for k in range(len(start) // 3):
        verts.append(to_b(start[k * 3], start[k * 3 + 1], start[k * 3 + 2]))
    for pc in data["pieces"]:
        off = pc["offset"]
        for k in range(len(pc["position"]) // 3):
            rest.append((pc["rest"][k * 2], -pc["rest"][k * 2 + 1], 0.0))
        idx = pc["index"]
        for t in range(0, len(idx), 3):
            faces.append((idx[t] + off, idx[t + 1] + off, idx[t + 2] + off))
    assert len(rest) == len(verts)
    edges = [tuple(e) for e in sew]

    mesh = bpy.data.meshes.new("camiseta")
    mesh.from_pydata(verts, edges, faces)
    mesh.update()
    obj = bpy.data.objects.new("camiseta", mesh)
    scene.collection.objects.link(obj)

    # Forma en reposo: el molde plano.
    obj.shape_key_add(name="Basis")
    sk = obj.shape_key_add(name="molde")
    sk.value = 0.0  # sólo para los largos en reposo, no para la forma inicial
    for i, co in enumerate(rest):
        sk.data[i].co = co

    # Junto a las costuras (donde dos piezas están pegadas) no hay colisión de
    # la tela consigo misma: si no, las partículas cosidas se repelen y la
    # simulación explota.
    seam = set()
    for a, b in edges:
        seam.add(a)
        seam.add(b)
    nbr = [[] for _ in verts]
    for f in faces:
        for e in range(3):
            nbr[f[e]].append(f[(e + 1) % 3])
            nbr[f[(e + 1) % 3]].append(f[e])
    near = set(seam)
    front = set(seam)
    for _ in range(opts.get("seam_rings", 2)):
        nxt = set()
        for v in front:
            for w in nbr[v]:
                if w not in near:
                    near.add(w)
                    nxt.add(w)
        front = nxt
    # Las mangas tampoco: cuelgan afuera del cuerpo y sólo chocan con la percha.
    if opts.get("sleeves_noself", True):
        for pc in data["pieces"]:
            if pc["key"].startswith("sleeve"):
                near.update(range(pc["offset"], pc["offset"] + len(pc["position"]) // 3))
    noself = obj.vertex_groups.new(name="sin_auto")
    noself.add(sorted(near), 1.0, "REPLACE")

    pin = obj.vertex_groups.new(name="fijo")
    pins = set(data["pins"]) if opts.get("pins", not use_body) else set()
    if pins:
        pin.add(sorted(pins), 1.0, "REPLACE")

    if not use_body:
        # Percha (sólida).
        hp = data["hanger"]["position"]
        hv = [to_b(hp[k * 3], hp[k * 3 + 1], hp[k * 3 + 2]) for k in range(len(hp) // 3)]
        hi = data["hanger"]["index"]
        hf = [(hi[t], hi[t + 1], hi[t + 2]) for t in range(0, len(hi), 3)]
        hmesh = bpy.data.meshes.new("percha")
        hmesh.from_pydata(hv, [], hf)
        hmesh.update()
        hobj = bpy.data.objects.new("percha", hmesh)
        scene.collection.objects.link(hobj)
        hobj.modifiers.new("col", "COLLISION")
        hobj.collision.thickness_outer = opts.get("hanger_thick", 0.003)
        hobj.collision.cloth_friction = 20.0

    cloth = obj.modifiers.new("tela", "CLOTH")
    s = cloth.settings
    s.quality = opts.get("quality", 10)
    s.mass = opts.get("mass", 0.02)
    s.air_damping = opts.get("air", 3.0)
    s.tension_stiffness = opts.get("tension", 40.0)
    s.compression_stiffness = opts.get("compression", 40.0)
    s.shear_stiffness = opts.get("shear", 20.0)
    s.bending_stiffness = opts.get("bending", 0.6)
    s.tension_damping = 5.0
    s.compression_damping = 5.0
    s.shear_damping = 5.0
    s.bending_damping = 0.5
    s.rest_shape_key = sk
    s.use_sewing_springs = True
    s.sewing_force_max = opts.get("sewing", 10.0)
    if pins:
        s.vertex_group_mass = "fijo"
        s.pin_stiffness = 1.0
    c = cloth.collision_settings
    c.use_collision = True
    c.distance_min = opts.get("col_dist", 0.003)
    c.collision_quality = opts.get("col_quality", 3)
    c.use_self_collision = opts.get("self", True)
    c.self_distance_min = opts.get("self_dist", 0.003)
    c.self_friction = 5.0
    c.vertex_group_self_collisions = "sin_auto"
    c.self_impulse_clamp = opts.get("self_clamp", 0.05)
    c.impulse_clamp = opts.get("clamp", 0.05)
    cloth.point_cache.frame_start = 1
    cloth.point_cache.frame_end = frames
    scene.frame_start = 1
    scene.frame_end = frames

    t0 = time.time()
    snaps = {}
    for f in range(1, frames + 1):
        scene.frame_set(f)
        if f % 10 == 0 or f == frames:
            print(f"cuadro {f}/{frames} {time.time() - t0:.1f}s", flush=True)
        if f in opts.get("snapshots", []):
            snaps[f] = read(obj)
    pos = read(obj)
    print(f"listo en {time.time() - t0:.1f}s", flush=True)
    return pos, snaps


def attach_sleeves(data, pos, wrap, opts):
    """Posiciones de partida de la etapa 2: el cuerpo como quedó armado y
    cada manga pegada a su sisa (la fila de la copa sobre los puntos de sisa
    con los que se cose), pasando suave al tubo alrededor del brazo."""
    pos = list(pos)
    owner = {}
    for pc in data["pieces"]:
        for k in range(len(pc["position"]) // 3):
            owner[pc["offset"] + k] = pc["key"]
    partner = {}
    for i, j in data["sew"]:
        a, b = owner[i], owner[j]
        if a.startswith("sleeve") and not b.startswith("sleeve"):
            partner.setdefault(i, []).append(j)
        elif b.startswith("sleeve") and not a.startswith("sleeve"):
            partner.setdefault(j, []).append(i)
    blend = opts.get("blend_rows", 12)
    for pc in data["pieces"]:
        if not pc["key"].startswith("sleeve"):
            continue
        off, cols, rows = pc["offset"], pc["Nu"] + 1, pc["row"]
        tube = wrap[pc["key"]]
        anchor = [None] * cols
        for j in range(cols):
            ps = partner.get(off + j * rows)
            if ps:
                anchor[j] = [sum(pos[p * 3 + c] for p in ps) / len(ps) for c in range(3)]
        known = [j for j in range(cols) if anchor[j]]
        for j in range(cols):
            if anchor[j]:
                continue
            lo = max([k for k in known if k < j], default=None)
            hi = min([k for k in known if k > j], default=None)
            if lo is None or hi is None:
                anchor[j] = list(anchor[hi if lo is None else lo])
            else:
                f = (j - lo) / (hi - lo)
                anchor[j] = [anchor[lo][c] + f * (anchor[hi][c] - anchor[lo][c]) for c in range(3)]
        for j in range(cols):
            for r in range(rows):
                k = j * rows + r
                t = min(1.0, r / blend)
                w = t * t * (3 - 2 * t)
                for c in range(3):
                    pos[(off + k) * 3 + c] = (1 - w) * anchor[j][c] + w * tube[k * 3 + c]
    return pos


def _ellipse_arc(a, b, n=4000):
    """Tabla (t, largo de arco desde el frente) de la elipse x = a sen t, z = b cos t."""
    ts, arc = [0.0], [0.0]
    px, pz = 0.0, b
    for i in range(1, n + 1):
        t = math.pi * i / n
        x, z = a * math.sin(t), b * math.cos(t)
        arc.append(arc[-1] + math.hypot(x - px, z - pz))
        ts.append(t)
        px, pz = x, z
    return ts, arc


def _arc_to_t(ts, arc, s):
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


def wrapped_positions(data, opts, joints):
    """Piezas curvadas alrededor del maniquí, sin estirarlas.

    Frente y espalda se enrollan sobre un cilindro elíptico vertical que rodea
    el torso (el ancho del molde es largo de arco: curvar así no estira la
    tela); cada manga, sobre un cilindro a lo largo del brazo, con la cabeza
    de la copa arriba y la costura de abajo hacia el cuerpo.
    """
    a, b = opts.get("wrap_a", 0.170), opts.get("wrap_b", 0.125)
    zc = opts.get("wrap_zc", 0.003)
    y0 = opts.get("wrap_y0", 0.0)
    ts, arc = _ellipse_arc(a, b)
    alpha = math.radians(opts.get("arm_angle", 33.0))
    s0 = opts.get("sleeve_s0", 0.0)
    out = {}
    for pc in data["pieces"]:
        r = pc["rest"]
        n = len(r) // 2
        us = [r[k * 2] for k in range(n)]
        vs = [r[k * 2 + 1] for k in range(n)]
        cx = (min(us) + max(us)) / 2
        top = min(vs)
        pos = []
        key = pc["key"]
        if key in ("front", "back"):
            for k in range(n):
                s = us[k] - cx
                if key == "front":
                    t = _arc_to_t(ts, arc, s)
                else:
                    t = math.pi + _arc_to_t(ts, arc, s)
                pos.extend((a * math.sin(t), y0 - (vs[k] - top), zc + b * math.cos(t)))
        else:
            side = 1 if key == "sleeveL" else -1
            zsign = -1 if side > 0 else 1  # manga izquierda: u creciente = atrás
            width = max(us) - min(us)
            R = opts.get("sleeve_r", width / (2 * math.pi))
            jx, jy = joints[side]
            d = (side * math.sin(alpha), -math.cos(alpha))
            nt = (side * math.cos(alpha), math.sin(alpha))
            for k in range(n):
                phi = (us[k] - cx) / R
                along = s0 + (vs[k] - top)
                pos.extend((
                    jx + d[0] * along + R * math.cos(phi) * nt[0],
                    jy + d[1] * along + R * math.cos(phi) * nt[1],
                    zsign * R * math.sin(phi),
                ))
        out[key] = pos
    return out


def seam_kind(data, i, j):
    """Tipo de costura de un par cosido: hombro, costado, sisa o manga."""
    def where(g):
        for pc in data["pieces"]:
            n = len(pc["position"]) // 3
            if pc["offset"] <= g < pc["offset"] + n:
                k = g - pc["offset"]
                return pc["key"], pc["rest"][k * 2 + 1] - min(pc["rest"][1::2])
        return None, 0
    (ka, va), (kb, vb) = where(i), where(j)
    if ka.startswith("sleeve") and kb.startswith("sleeve"):
        return "underarm"
    if ka.startswith("sleeve") or kb.startswith("sleeve"):
        return "armhole"
    return "shoulder" if min(va, vb) < 0.06 else "side"


def sleeve_axes(data):
    """Centro de la sisa y del puño de cada manga (x, y) en la camiseta plana."""
    out = {}
    for pc in data["pieces"]:
        if not pc["key"].startswith("sleeve"):
            continue
        cols, rows = pc["Nu"] + 1, pc["row"]
        p = pc["position"]
        ends = []
        for r in (0, rows - 1):
            ks = [j * rows + r for j in range(cols)]
            ends.append((sum(p[k * 3] for k in ks) / cols, sum(p[k * 3 + 1] for k in ks) / cols))
        out[1 if ends[0][0] > 0 else -1] = tuple(ends)
    return out


def read(obj):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    m = ev.to_mesh()
    pos = []
    for v in m.vertices:
        pos.extend(from_b(*v.co))
    ev.to_mesh_clear()
    return [round(x, 6) for x in pos]


if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    src, dst = sys.argv[1], sys.argv[2]
    frames = int(sys.argv[3]) if len(sys.argv) > 3 else 160
    opts = json.loads(sys.argv[4]) if len(sys.argv) > 4 else {}
    main(src, dst, frames, opts)
