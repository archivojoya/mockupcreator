"""Maniquí invisible para la camiseta "sostenida" (drape_blender.py).

Un torso con cuello y dos brazos, hechos como superficies de revolución
deformadas (cortes superelípticos que se interpolan suave), usados como
sólidos de colisión. Las piezas de la camiseta se arman a su alrededor y la
tela se asienta sobre él; en la página el maniquí no se ve.

Coordenadas como en three.js (metros, y arriba, z hacia la cámara); y = 0 es
el punto más alto del hombro de la camiseta plana.
"""
import math

import bpy

# Cortes del torso: (y, medio ancho, media profundidad, centro z). Talle M
# delgado, para una camiseta de ~89 cm de pecho (≈6 cm de holgura).
TORSO = [
    (0.10, 0.055, 0.055, -0.016),
    (0.00, 0.057, 0.057, -0.016),
    (-0.016, 0.072, 0.064, -0.014),
    (-0.030, 0.110, 0.070, -0.012),
    (-0.045, 0.148, 0.076, -0.010),
    (-0.062, 0.163, 0.084, -0.006),
    (-0.090, 0.167, 0.093, -0.002),
    (-0.140, 0.160, 0.103, 0.002),
    (-0.220, 0.150, 0.108, 0.005),
    (-0.300, 0.146, 0.105, 0.004),
    (-0.400, 0.140, 0.098, 0.000),
    (-0.500, 0.141, 0.096, -0.002),
    (-0.620, 0.148, 0.099, -0.004),
    (-0.720, 0.152, 0.101, -0.005),
    (-0.900, 0.152, 0.101, -0.005),
]
SUPER = 2.3  # exponente de los cortes (2 = elipse; más = más cuadrado)
# Brazo: radio según la distancia a la articulación del hombro.
ARM = [(0.0, 0.052), (0.05, 0.050), (0.12, 0.047), (0.20, 0.044), (0.30, 0.042)]
RING = 64  # puntos por corte


def to_b(x, y, z):
    return (x, -z, y)


def _catmull(rows, y, k):
    """Interpola la columna k de la tabla (ordenada por y descendente)."""
    ys = [r[0] for r in rows]
    if y >= ys[0]:
        return rows[0][k]
    if y <= ys[-1]:
        return rows[-1][k]
    i = 0
    while ys[i + 1] > y:
        i += 1
    p0 = rows[max(i - 1, 0)][k]
    p1 = rows[i][k]
    p2 = rows[i + 1][k]
    p3 = rows[min(i + 2, len(rows) - 1)][k]
    t = (ys[i] - y) / (ys[i] - ys[i + 1])
    # Catmull-Rom (uniforme): suave y pasa por los puntos de la tabla.
    return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3)


def _superellipse(a, b, n, th):
    c, s = math.cos(th), math.sin(th)
    return (a * math.copysign(abs(c) ** (2 / n), c), b * math.copysign(abs(s) ** (2 / n), s))


def _loft(rings, caps=True):
    """Malla cerrada a partir de anillos de igual cantidad de puntos."""
    verts, faces = [], []
    n = len(rings[0])
    for r in rings:
        verts.extend(r)
    for j in range(len(rings) - 1):
        for i in range(n):
            a = j * n + i
            b = j * n + (i + 1) % n
            faces.append((a, a + n, b + n, b))
    if caps:
        for j, flip in ((0, False), (len(rings) - 1, True)):
            ring = rings[j]
            c = tuple(sum(p[t] for p in ring) / n for t in range(3))
            verts.append(c)
            ci = len(verts) - 1
            for i in range(n):
                a = j * n + i
                b = j * n + (i + 1) % n
                faces.append((ci, b, a) if flip else (ci, a, b))
    return verts, faces


def torso_mesh(step=0.006):
    y0, y1 = TORSO[0][0], TORSO[-1][0]
    rings = []
    steps = int(round((y0 - y1) / step))
    for j in range(steps + 1):
        y = y0 - (y0 - y1) * j / steps
        a, b, c = (_catmull(TORSO, y, k) for k in (1, 2, 3))
        ring = []
        for i in range(RING):
            th = 2 * math.pi * i / RING
            x, z = _superellipse(a, b, SUPER, th)
            ring.append(to_b(x, y, z + c))
        rings.append(ring)
    # De abajo hacia arriba para que las normales miren afuera.
    rings.reverse()
    return _loft(rings)


def arm_mesh(deltoid=None):
    """Brazo colgando hacia abajo desde el origen (la articulación)."""
    arm = ARM if deltoid is None else [(0.0, deltoid), (0.05, (deltoid + ARM[1][1]) / 2)] + ARM[2:]
    rings = []
    r0 = arm[0][1]
    L = arm[-1][0]
    rows = [(-s, r) for s, r in arm]
    # Casquete esférico arriba (hombro), tubo y casquete abajo.
    for k in range(8, 0, -1):
        phi = math.pi / 2 * k / 8
        rings.append((r0 * math.sin(phi), r0 * math.cos(phi)))
    s = 0.0
    while s < L:
        rings.append((-s, _catmull(rows, -s, 1)))
        s += 0.006
    rl = arm[-1][1]
    for k in range(0, 9):
        phi = math.pi / 2 * k / 8
        rings.append((-L - rl * math.sin(phi), rl * math.cos(phi)))
    out = []
    for y, r in rings:
        r = max(r, 1e-4)
        out.append([to_b(r * math.cos(2 * math.pi * i / RING), y, r * math.sin(2 * math.pi * i / RING)) for i in range(RING)])
    out.reverse()
    return _loft(out)


def _object(scene, name, verts, faces):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    return ob


def joints(sleeve_axes, opts):
    """Articulación de cada hombro (x, y): sobre el eje de la manga de la
    camiseta plana, a la altura de los hombros del torso."""
    out = {}
    jy = opts.get("joint_y", -0.085)
    for side, (pit, cuff) in sleeve_axes.items():
        dx, dy = cuff[0] - pit[0], cuff[1] - pit[1]
        out[side] = (pit[0] + (jy - pit[1]) * dx / dy + side * opts.get("joint_dx", 0.0), jy)
    return out


def build_body(scene, sleeve_axes, opts):
    """Crea el maniquí (torso y brazos) como sólidos de colisión.

    sleeve_axes: {+1: (sisa, puño), -1: (...)} centros (x, y) de la sisa y del
    puño de cada manga en la camiseta plana (ubican los hombros).
    """
    arm_angle = math.radians(opts.get("arm_angle", 33.0))  # desde la vertical
    objs = [_object(scene, "torso", *torso_mesh())]
    for side, (jx, jy) in joints(sleeve_axes, opts).items():
        arm = _object(scene, "brazoL" if side > 0 else "brazoR", *arm_mesh(opts.get("deltoid")))
        arm.location = to_b(jx, jy, 0.0)
        # Giro en el plano frontal (eje y de Blender): del lado +x, ángulo
        # negativo abre el brazo hacia afuera.
        arm.rotation_euler = (0.0, -side * arm_angle, 0.0)
        objs.append(arm)
    for obj in objs:
        obj.modifiers.new("col", "COLLISION")
        obj.collision.thickness_outer = opts.get("body_thick", 0.004)
        obj.collision.thickness_inner = 0.02
        obj.collision.cloth_friction = opts.get("body_friction", 2.0)
        obj.collision.damping = 0.5
    return objs
