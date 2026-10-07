"""Paso 2 de la plantilla: simula la caída de la camiseta con el simulador
de tela de Blender (sin interfaz) y guarda la forma final.

    python drape_blender.py entrada.json salida.json [cuadros]

Necesita el módulo bpy (pip install bpy). La entrada la arma
export-initial.mjs: piezas con su forma 3D inicial y su molde plano, pares de
costura, fijaciones y la percha. El molde plano es la forma en reposo de la
tela (largos y curvatura), así la tela cae como cae su molde de verdad.
"""
import json
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
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene

    verts, faces, rest = [], [], []
    for pc in data["pieces"]:
        p = pc["position"]
        off = pc["offset"]
        assert off == len(verts)
        for k in range(len(p) // 3):
            verts.append(to_b(p[k * 3], p[k * 3 + 1], p[k * 3 + 2]))
            rest.append((pc["rest"][k * 2], -pc["rest"][k * 2 + 1], 0.0))
        idx = pc["index"]
        for t in range(0, len(idx), 3):
            faces.append((idx[t] + off, idx[t + 1] + off, idx[t + 2] + off))
    edges = [tuple(e) for e in data["sew"]]

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
    pins = set(data["pins"]) if opts.get("pins", True) else set()
    if pins:
        pin.add(sorted(pins), 1.0, "REPLACE")

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
    col = hobj.modifiers.new("col", "COLLISION")
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
        # Avance parcial (para mirar la caída mientras simula).
        if opts.get("progress") and f % opts["progress"] == 0 and f < frames:
            json.dump({"position": read(obj), "frame": f}, open(dst, "w"))
    out = {"position": read(obj), "snapshots": {str(k): v for k, v in snaps.items()}}
    json.dump(out, open(dst, "w"))
    print(f"listo en {time.time() - t0:.1f}s")


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
    src, dst = sys.argv[1], sys.argv[2]
    frames = int(sys.argv[3]) if len(sys.argv) > 3 else 160
    opts = json.loads(sys.argv[4]) if len(sys.argv) > 4 else {}
    main(src, dst, frames, opts)
